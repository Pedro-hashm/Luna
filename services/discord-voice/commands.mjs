import { SlashCommandBuilder } from 'discord.js';

export const commands = new SlashCommandBuilder()
  .setName('luna')
  .setDescription('Usa a Luna no canal de voz configurado')
  .addSubcommand(command => command.setName('entrar').setDescription('Conecta a Luna ao canal de voz'))
  .addSubcommand(command => command.setName('perguntar').setDescription('Envia uma pergunta por escrito para a Luna responder em voz')
    .addStringOption(option => option.setName('query').setDescription('Sua pergunta para a Luna')
      .setMinLength(1).setMaxLength(1_200).setRequired(true)))
  .addSubcommand(command => command.setName('sair').setDescription('Desconecta a Luna do canal de voz'));

export function readQuestion(interaction, conversationSessionId) {
  const query = interaction.options.getString('query')?.trim();
  if (!query || query.length > 1_200) return undefined;
  return {
    query,
    guildId: interaction.guildId,
    conversationSessionId,
    userId: interaction.user.id,
    username: interaction.member?.displayName || interaction.member?.nick ||
      interaction.user.globalName || interaction.user.username,
  };
}
