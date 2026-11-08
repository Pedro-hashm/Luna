import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  ChannelType, Client, Events, GatewayIntentBits, MessageFlags, PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import {
  AudioPlayerStatus, EndBehaviorType, NoSubscriberBehavior, StreamType, VoiceConnectionStatus,
  createAudioPlayer, createAudioResource, entersState, joinVoiceChannel,
} from '@discordjs/voice';
import OpusScript from 'opusscript';
import { createProviders, localBase, readControlSettings } from './providers.mjs';
import { downsampleDiscordPcm, VoiceRoom, wakeChime } from './voice-room.mjs';

const api = localBase(process.env.LUNA_API_URL || 'http://api:8000');
const secret = (process.env.DISCORD_VOICE_WORKER_SECRET ?? '').trim();
const token = (process.env.DISCORD_BOT_TOKEN ?? '').trim();
const providers = createProviders();
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const commands = new SlashCommandBuilder()
  .setName('luna')
  .setDescription('Usa a Luna no canal de voz configurado')
  .addSubcommand(command => command.setName('entrar').setDescription('Conecta a Luna ao canal de voz'))
  .addSubcommand(command => command.setName('perguntar').setDescription('Pergunta por texto ou fala com a Luna')
    .addStringOption(option => option.setName('query').setDescription('Pergunta para a Luna responder em voz')
      .setMinLength(1).setMaxLength(1_200).setRequired(false)))
  .addSubcommand(command => command.setName('participar').setDescription('Autoriza escuta temporária para chamar a Luna'))
  .addSubcommand(command => command.setName('parar').setDescription('Encerra sua participação e apaga seu contexto da call'))
  .addSubcommand(command => command.setName('sair').setDescription('Desconecta a Luna do canal de voz'));

const log = (event, details) => console.info('[discord-voice] ' + event + (details ? ' ' + JSON.stringify(details) : ''));
const botPermissions = [
  PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak,
];
const cue = wakeChime();
let control = { enabled: false, guildId: null, channelId: null };
let session;
let commandGuild;
let loginAfter = 0;
let loginStarted = false;
let loginFailed = false;
let voiceFailed = false;
let stopped = false;
let pollTimer;

function destination(guildId, channelId) {
  const guild = client.guilds.cache.get(guildId);
  const channel = guild?.channels.cache.get(channelId);
  if (channel?.type !== ChannelType.GuildVoice || !guild.members.me ||
      !channel.permissionsFor(guild.members.me)?.has(botPermissions)) return undefined;
  return channel;
}

function listDestinations() {
  return [...client.guilds.cache.values()].slice(0, 100).map(guild => ({
    id: guild.id,
    name: guild.name.slice(0, 100),
    channels: [...guild.channels.cache.values()]
      .filter(channel => destination(guild.id, channel.id))
      .slice(0, 500)
      .map(channel => ({ id: channel.id, name: channel.name.slice(0, 100) })),
  }));
}

async function controlRequest(path, options = {}) {
  const response = await fetch(api + '/discord-voice/worker' + path, {
    ...options, redirect: 'error', signal: AbortSignal.timeout(2_000),
    headers: { authorization: 'Bearer ' + secret, 'content-type': 'application/json' },
  });
  if (!response.ok) throw new Error('control');
  return response;
}

function applyControl(next) {
  if (next.guildId !== control.guildId || next.channelId !== control.channelId || next.enabled !== control.enabled) {
    closeVoice();
    voiceFailed = false;
  }
  control = next;
}

function startLogin() {
  if (loginStarted || client.isReady() || Date.now() < loginAfter) return;
  loginStarted = true;
  loginFailed = false;
  void client.login(token).catch(() => {
    loginFailed = true;
    loginAfter = Date.now() + 60_000;
    log('discord_login_failed');
  }).finally(() => { loginStarted = false; });
}

async function poll() {
  let state = 'error';
  let reachable = false;
  try {
    const next = readControlSettings(await (await controlRequest('')).json());
    if (stopped) return;
    applyControl(next);
    reachable = true;
    if (!token) {
      state = 'missing_token';
    } else if (!client.isReady()) {
      startLogin();
      state = loginFailed ? 'error' : 'connecting';
    } else if (!control.enabled) {
      state = 'disabled';
    } else if (!destination(control.guildId, control.channelId)) {
      closeVoice();
      state = 'error';
    } else {
      if (commandGuild !== control.guildId) {
        await client.application.commands.create(commands.toJSON(), control.guildId);
        commandGuild = control.guildId;
      }
      state = voiceFailed ? 'error' : session?.connection.state.status === VoiceConnectionStatus.Ready
        ? 'in_channel' : session ? 'connecting' : 'ready';
    }
  } catch {
    if (!reachable) applyControl({ enabled: false, guildId: null, channelId: null });
    log('control_or_registration_unavailable');
  }
  if (stopped) return;
  try {
    await controlRequest('/status', {
      method: 'POST',
      body: JSON.stringify({ state, ...(client.isReady() ? { destinations: listDestinations() } : {}) }),
    });
  } catch {
    // The API expires this status. An unreachable control endpoint is handled above.
  }
  if (!stopped) pollTimer = setTimeout(poll, 5_000);
}

function play(player, data, inputType, signal) {
  if (signal.aborted) return Promise.reject(new Error('cancelled'));
  return new Promise((resolve, reject) => {
    const resource = createAudioResource(Readable.from([data]), { inputType });
    const finish = error => {
      clearTimeout(timer);
      player.off(AudioPlayerStatus.Idle, onIdle);
      player.off('error', onError);
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onIdle = () => finish();
    const onError = () => finish(new Error('playback'));
    const onAbort = () => {
      finish(new Error('cancelled'));
      player.stop(true);
    };
    const timer = setTimeout(onAbort, 45_000);
    player.once(AudioPlayerStatus.Idle, onIdle);
    player.once('error', onError);
    signal.addEventListener('abort', onAbort, { once: true });
    player.play(resource);
  });
}

function stopStream(current, userId) {
  const stream = current.streams.get(userId);
  if (!stream) return;
  current.streams.delete(userId);
  stream.destroy();
}

function dropParticipant(current, userId) {
  current.room.remove(userId);
  stopStream(current, userId);
}

function resetParticipants(current) {
  current.room.reset();
  for (const userId of current.streams.keys()) stopStream(current, userId);
}

function subscribe(current, userId) {
  if (current.streams.has(userId) || !current.room.has(userId) ||
      current.connection.state.status !== VoiceConnectionStatus.Ready) return;
  const stream = current.connection.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.Manual } });
  const decoder = new OpusScript(48_000, 2, OpusScript.Application.VOIP);
  current.streams.set(userId, stream);
  stream.on('data', packet => {
    try {
      current.room.receive(userId, downsampleDiscordPcm(decoder.decode(packet)));
    } catch {
      stream.destroy();
      log('opus_decode_failed');
    }
  });
  stream.on('error', () => log('discord_receive_error'));
  stream.once('close', () => {
    decoder.delete();
    if (current.streams.get(userId) === stream) current.streams.delete(userId);
  });
}

function closeVoice() {
  const current = session;
  if (!current) return;
  session = undefined;
  clearInterval(current.timer);
  resetParticipants(current);
  current.player.stop(true);
  if (current.connection.state.status !== VoiceConnectionStatus.Destroyed) current.connection.destroy();
}

async function join(channel) {
  if (session || !control.enabled || channel.id !== control.channelId || channel.guild.id !== control.guildId) {
    throw new Error('cancelled');
  }
  voiceFailed = false;
  const connection = joinVoiceChannel({
    guildId: channel.guild.id, channelId: channel.id,
    adapterCreator: channel.guild.voiceAdapterCreator, selfDeaf: false, selfMute: false,
  });
  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Stop } });
  player.on('error', () => log('discord_playback_error'));
  let current;
  const room = new VoiceRoom({
    providers, log,
    playCue: signal => play(player, cue, StreamType.Raw, signal),
    playReply: (audio, signal) => play(player, audio, StreamType.Arbitrary, signal),
    stopPlayback: () => player.stop(true),
    onTemporaryEnd: userId => { if (current) stopStream(current, userId); },
  });
  current = { callId: randomUUID(), connection, player, room, streams: new Map(), timer: setInterval(() => room.tick(), 100) };
  session = current;
  connection.subscribe(player);
  connection.receiver.speaking.on('start', userId => {
    if (session === current) subscribe(current, userId);
  });
  connection.on('stateChange', (before, after) => {
    if (session !== current) return;
    if (before.status === VoiceConnectionStatus.Ready && after.status !== VoiceConnectionStatus.Ready) resetParticipants(current);
    if (after.status === VoiceConnectionStatus.Destroyed) closeVoice();
    if (after.status === VoiceConnectionStatus.Disconnected) {
      void entersState(connection, VoiceConnectionStatus.Ready, 6_000).catch(() => {
        if (session === current) closeVoice();
      });
    }
  });
  connection.on('error', () => log('discord_connection_error'));
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    if (session !== current) throw new Error('cancelled');
  } catch {
    if (session === current) {
      voiceFailed = true;
      closeVoice();
    }
    throw new Error('join');
  }
}

client.on(Events.VoiceStateUpdate, (before, after) => {
  if (!session || after.guild.id !== control.guildId || before.channelId === after.channelId) return;
  if (after.id === client.user?.id && after.channelId !== control.channelId) closeVoice();
  else if (after.channelId !== control.channelId) dropParticipant(session, after.id);
});

client.on(Events.InteractionCreate, interaction => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'luna') return;
  void handleCommand(interaction).catch(async () => {
    log('discord_command_failed');
    const error = 'Não consegui completar essa ação. Confira o estado da integração nas configurações da Luna.';
    if (interaction.deferred || interaction.replied) await interaction.editReply(error).catch(() => {});
    else await interaction.reply({ content: error, flags: MessageFlags.Ephemeral }).catch(() => {});
  });
});

async function handleCommand(interaction) {
  const reply = content => interaction.reply({ content, flags: MessageFlags.Ephemeral });
  if (!control.enabled || interaction.guildId !== control.guildId) {
    await reply('A integração de voz da Luna não está ativa neste servidor.');
    return;
  }
  const channel = destination(control.guildId, control.channelId);
  if (!channel || interaction.guild.voiceStates.cache.get(interaction.user.id)?.channelId !== channel.id) {
    await reply('Entre no canal de voz selecionado nas configurações da Luna.');
    return;
  }
  const command = interaction.options.getSubcommand();
  if (command === 'entrar' || command === 'sair') {
    if (interaction.user.id !== channel.guild.ownerId &&
        !interaction.memberPermissions?.any([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageGuild])) {
      await reply('Quem administra o canal pode conectar ou desconectar a Luna.');
      return;
    }
    if (command === 'sair') {
      closeVoice();
      await reply('A Luna saiu da call. O contexto temporário foi apagado.');
      return;
    }
    if (session) {
      await reply('A Luna já está conectada ou está entrando na call.');
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const selected = destination(control.guildId, control.channelId);
    if (!control.enabled || session || selected !== channel ||
        interaction.guild.voiceStates.cache.get(interaction.user.id)?.channelId !== channel.id) {
      await interaction.editReply('A sala ou o estado da Luna mudou. Confira o canal e tente novamente.');
      return;
    }
    await join(selected);
    await interaction.editReply('A Luna entrou. Use /luna perguntar para um turno ou /luna participar para ativar o wake word.');
    return;
  }
  const current = session;
  if (current?.connection.state.status !== VoiceConnectionStatus.Ready) {
    await reply('A Luna precisa estar conectada na call.');
    return;
  }
  if (command === 'parar') {
    dropParticipant(current, interaction.user.id);
    await reply('Sua participação terminou e seu contexto temporário foi apagado.');
    return;
  }
  if (command === 'perguntar' && !interaction.user.bot) {
    if (current.room.turn) {
      await reply('A Luna já está respondendo a outra pessoa. Tente novamente em instantes.');
      return;
    }
    const alreadyParticipating = current.room.has(interaction.user.id);
    const requestContext = {
      guildId: interaction.guildId,
      conversationSessionId: current.callId,
      username: interaction.user.globalName || interaction.user.username,
    };
    if (!current.room.add(interaction.user.id, { requestContext, temporary: true })) {
      await reply('A call já tem quatro participantes ativos. Tente novamente quando houver uma vaga.');
      return;
    }
    const query = interaction.options.getString('query');
    if (query !== null) {
      if (!query.trim()) {
        if (!alreadyParticipating) dropParticipant(current, interaction.user.id);
        await reply('Escreva uma pergunta ou deixe o campo vazio para falar com a Luna.');
        return;
      }
      if (!current.room.askText(interaction.user.id, query.trim(), requestContext)) {
        if (!alreadyParticipating) dropParticipant(current, interaction.user.id);
        await reply('Já existe outro turno em andamento. Tente novamente em instantes.');
        return;
      }
      await reply('Pergunta enviada. A Luna vai responder em voz pela conversa normal e salvar o turno na interface.');
      return;
    }
    if (!current.room.listenOnce(interaction.user.id, requestContext)) {
      if (!alreadyParticipating) dropParticipant(current, interaction.user.id);
      await reply('Já existe outro turno em andamento. Tente novamente em instantes.');
      return;
    }
    subscribe(current, interaction.user.id);
    await reply('A Luna vai tocar o bip e ouvir seu próximo turno. Sua transcrição e a resposta serão salvas na interface local da Luna; todos na call ouvirão a resposta.');
    return;
  }
  if (command !== 'participar' || interaction.user.bot) return;
  const requestContext = {
    guildId: interaction.guildId,
    conversationSessionId: current.callId,
    username: interaction.user.globalName || interaction.user.username,
  };
  if (!current.room.add(interaction.user.id, { requestContext })) {
    await reply('O piloto aceita até quatro participantes por call. Tente quando houver uma vaga.');
    return;
  }
  subscribe(current, interaction.user.id);
  await reply('Sua escuta temporária está ativa. Diga “Luna” para chamar. Cada fala transcrita e resposta será salva na interface local da Luna; todos na call ouvem o bip e a resposta. O áudio bruto não é salvo. Use /luna parar para sair.');
}

client.on(Events.Error, () => log('discord_client_error'));

function stop() {
  stopped = true;
  clearTimeout(pollTimer);
  closeVoice();
  client.destroy();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
if (!secret) log('missing_worker_secret');
else void poll();

