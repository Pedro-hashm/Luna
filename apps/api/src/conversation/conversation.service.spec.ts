import { ConversationService } from './conversation.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserAgentService } from '../user-agent/user-agent.service';
import { ContextManagerService } from '../user-agent/context-manager/context-manager.service';
import { ConversationChunkService } from './conversation-chunk.service';
import { SettingsService } from '../settings/settings.service';
import { ObservabilityService } from '../observability/observability.service';
import { EvidenceService } from '../evidence/evidence.service';

describe('ConversationService Discord persistence', () => {
  const conversationId = '00000000-0000-4000-8000-000000000001';
  const sessionId = 'f57dff0d-6228-4dc5-9678-a18ea54d385d';
  const baseConversation = {
    id: conversationId, source: 'discord', sourceUserId: '99', sourceGuildId: '42',
    memoryScope: 'discord:42:99',
  };
  let findUnique: jest.Mock;
  let create: jest.Mock;
  let update: jest.Mock;
  let processMessage: jest.SpyInstance;
  let service: ConversationService;

  beforeEach(() => {
    findUnique = jest.fn().mockResolvedValue(null);
    create = jest.fn().mockResolvedValue(baseConversation);
    update = jest.fn().mockImplementation(async ({ data }) => ({ ...baseConversation, ...data }));
    const prisma = { conversation: { findUnique, create, update } };
    service = new ConversationService(
      prisma as unknown as PrismaService,
      {} as UserAgentService,
      {} as ContextManagerService,
      {} as ConversationChunkService,
      {} as SettingsService,
      {} as ObservabilityService,
      {} as EvidenceService,
    );
    processMessage = jest.spyOn(service as never, 'processMessage' as never).mockResolvedValue({
      requestId: '00000000-0000-4000-8000-000000000002', conversationId, messages: [],
    } as never);
  });

  it('creates one voice conversation per Discord person per call with a private guest memory scope', async () => {
    await service.addDiscordMessage({
      guildId: '42', userId: '99', sessionId, username: 'Alice', transcript: 'Oi, Luna.', owner: false,
    });

    expect(create).toHaveBeenCalledWith({ data: {
      title: 'Discord · Alice', source: 'discord', memoryScope: 'discord:42:99',
      sourceKey: `42:${sessionId}:99`, sourceUserId: '99', sourceGuildId: '42',
    } });
    expect(processMessage).toHaveBeenCalledWith(conversationId, 'Oi, Luna.', { inputMode: 'voice', outputMode: 'voice' });
  });

  it('maps the configured owner to global memory and updates the identity on an existing call', async () => {
    findUnique.mockResolvedValue(baseConversation);

    await service.addDiscordMessage({
      guildId: '42', userId: '99', sessionId, username: 'Pedro', transcript: 'Minha memória.', owner: true,
    });

    expect(update).toHaveBeenCalledWith({ where: { id: conversationId }, data: { memoryScope: 'global' } });
    expect(processMessage).toHaveBeenCalledWith(conversationId, 'Minha memória.', { inputMode: 'voice', outputMode: 'voice' });
  });
});
