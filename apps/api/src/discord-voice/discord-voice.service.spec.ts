import { ForbiddenException } from '@nestjs/common';
import { DiscordVoiceService } from './discord-voice.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationService } from '../conversation/conversation.service';
import { VoiceSynthesisService } from '../voice/voice-synthesis.service';

describe('DiscordVoiceService worker turns', () => {
  const audio = Buffer.from('synthetic-audio');
  const configuration = {
    enabled: true, guildId: '42', channelId: '99', ownerDiscordUserId: '100',
  };
  let findSettings: jest.Mock;
  let addDiscordMessage: jest.Mock;
  let synthesizeText: jest.Mock;
  let service: DiscordVoiceService;

  beforeEach(() => {
    findSettings = jest.fn().mockResolvedValue(configuration);
    addDiscordMessage = jest.fn().mockResolvedValue({
      messages: [{}, { content: 'Resposta sintética.' }],
    });
    synthesizeText = jest.fn().mockResolvedValue({ audio, mimeType: 'audio/mpeg' });
    service = new DiscordVoiceService(
      { discordVoiceSettings: { findUnique: findSettings } } as unknown as PrismaService,
      { addDiscordMessage } as unknown as ConversationService,
      { synthesizeText } as unknown as VoiceSynthesisService,
    );
  });

  it('saves the recognized turn in Luna and synthesizes it with the configured voice', async () => {
    const result = await service.processWorkerTurn({
      guildId: '42', userId: '100', sessionId: 'f57dff0d-6228-4dc5-9678-a18ea54d385d',
      username: 'Pedro', transcript: 'Qual é meu jogo favorito?',
    });

    expect(addDiscordMessage).toHaveBeenCalledWith(expect.objectContaining({
      guildId: '42', userId: '100', username: 'Pedro',
      transcript: 'Qual é meu jogo favorito?', owner: true,
    }));
    expect(synthesizeText).toHaveBeenCalledWith('Resposta sintética.', expect.any(AbortSignal));
    expect(result).toEqual({ audio, mimeType: 'audio/mpeg' });
  });

  it('assigns a guest to a non-owner identity', async () => {
    await service.processWorkerTurn({
      guildId: '42', userId: '101', sessionId: 'f57dff0d-6228-4dc5-9678-a18ea54d385d',
      username: 'Convidado', transcript: 'Oi, Luna.',
    });
    expect(addDiscordMessage).toHaveBeenCalledWith(expect.objectContaining({ owner: false }));
  });

  it('rejects turns from servers outside the configured integration', async () => {
    await expect(service.processWorkerTurn({
      guildId: '43', userId: '101', sessionId: 'f57dff0d-6228-4dc5-9678-a18ea54d385d',
      username: 'Convidado', transcript: 'Oi, Luna.',
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(addDiscordMessage).not.toHaveBeenCalled();
  });
});
