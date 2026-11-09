import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  ChannelType, Client, Events, GatewayIntentBits, MessageFlags, PermissionFlagsBits,
} from 'discord.js';
import {
  AudioPlayerStatus, NoSubscriberBehavior, StreamType, VoiceConnectionStatus,
  createAudioPlayer, createAudioResource, entersState, joinVoiceChannel,
} from '@discordjs/voice';
import { commands, readQuestion } from './commands.mjs';
import { createProviders, localBase, readControlSettings } from './providers.mjs';
import { VoiceRoom } from './voice-room.mjs';

const api = localBase(process.env.LUNA_API_URL || 'http://api:8000');
const secret = (process.env.DISCORD_VOICE_WORKER_SECRET ?? '').trim();
const token = (process.env.DISCORD_BOT_TOKEN ?? '').trim();
const providers = createProviders();
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const log = event => console.info('[discord-voice] ' + event);
const botPermissions = [
  PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak,
];
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

function play(player, data, signal) {
  if (signal.aborted) return Promise.reject(new Error('cancelled'));
  return new Promise((resolve, reject) => {
    const resource = createAudioResource(Readable.from([data]), { inputType: StreamType.Arbitrary });
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

function closeVoice() {
  const current = session;
  if (!current) return;
  session = undefined;
  current.room.cancel();
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
    adapterCreator: channel.guild.voiceAdapterCreator, selfDeaf: true, selfMute: false,
  });
  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Stop } });
  player.on('error', () => log('discord_playback_error'));
  const room = new VoiceRoom({
    providers, log,
    playReply: (audio, signal) => play(player, audio, signal),
  });
  const current = { callId: randomUUID(), connection, player, room };
  session = current;
  connection.subscribe(player);
  connection.on('stateChange', (before, after) => {
    if (session !== current) return;
    if (after.status === VoiceConnectionStatus.Destroyed) {
      closeVoice();
      return;
    }
    if (before.status === VoiceConnectionStatus.Ready && after.status !== VoiceConnectionStatus.Ready) {
      room.cancel();
    }
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
  else if (after.channelId !== control.channelId) session.room.cancel(after.id);
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
      await reply('A Luna saiu da call.');
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
    await interaction.editReply('A Luna entrou. Use /luna perguntar com o campo query. Ela identifica a sua conta do Discord e responde em voz para a call.');
    return;
  }
  const current = session;
  if (current?.connection.state.status !== VoiceConnectionStatus.Ready) {
    await reply('A Luna precisa estar conectada na call.');
    return;
  }
  if (command !== 'perguntar' || interaction.user.bot) {
    await reply('Use /luna perguntar com o campo query para enviar sua pergunta por escrito.');
    return;
  }
  const question = readQuestion(interaction, current.callId);
  if (!question) {
    await reply('Preencha o campo query com a sua pergunta.');
    return;
  }
  const turn = current.room.askText(question);
  if (!turn) {
    await reply('A Luna já está processando uma pergunta. Tente novamente quando ela terminar.');
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const outcome = await turn;
  if (outcome === 'complete') {
    await interaction.editReply('A Luna respondeu em voz à pergunta enviada pela sua conta.');
  } else if (outcome === 'cancelled') {
    await interaction.editReply('A resposta em voz foi interrompida porque a conexão com a call mudou.');
  } else {
    await interaction.editReply('A Luna não conseguiu concluir a resposta em voz. Confira a integração e tente novamente.');
  }
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

