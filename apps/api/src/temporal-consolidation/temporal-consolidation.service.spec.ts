import { ConflictException } from '@nestjs/common';
import { MessageRole } from '@prisma/client';
import { LlmService } from '../llm/llm.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ConversationRetrievalService } from '../tools/conversation-retrieval/conversation-retrieval.service';
import { TemporalConsolidationService } from './temporal-consolidation.service';

const earlier = {
  id: '11111111-1111-4111-8111-111111111111',
  conversationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  role: MessageRole.user,
  content: 'O projeto se chama Nebula 47.',
  createdAt: new Date('2026-09-12T12:00:00Z'),
};
const later = {
  id: '22222222-2222-4222-8222-222222222222',
  conversationId: earlier.conversationId,
  role: MessageRole.user,
  content: 'Mudamos o nome. Agora é Nebula 48.',
  createdAt: new Date('2026-09-19T12:00:00Z'),
};

function setup(options: { enabled?: boolean; messages?: typeof later[]; dryRun?: boolean } = {}) {
  const settings = {
    temporalConsolidationEnabled: options.enabled ?? true,
    temporalConsolidationDefaultCombo: 'configured-local',
    temporalConsolidationFallbackCombo: 'configured-remote',
    temporalConsolidationStartTime: '00:00',
    temporalConsolidationEndTime: '00:01',
    appTimezone: 'UTC',
    retrievalMaxTopK: 50,
    retrievalMaxContextTokens: 20_000,
  };
  const runCreate = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data }));
  const runUpdate = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'run', ...data }));
  const relationCreate = jest.fn(async () => ({}));
  const checkpointUpdate = jest.fn(async (_input: { data?: Record<string, unknown> }) => ({ count: 1 }));
  const prisma = {
    temporalConsolidationCheckpoint: {
      upsert: jest.fn(async () => ({})),
      findUniqueOrThrow: jest.fn(async () => ({
        lastMessageCreatedAt: null,
        lastMessageId: null,
        activeRunId: null,
        lockExpiresAt: null,
      })),
      updateMany: checkpointUpdate,
    },
    temporalConsolidationRun: {
      create: runCreate,
      update: runUpdate,
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    message: {
      findMany: jest.fn(async () => options.messages ?? []),
      findFirst: jest.fn(async () => later),
    },
    temporalRelation: { findUnique: jest.fn(async () => null) },
    $queryRaw: jest.fn(async () => [{
      ...earlier,
      score: 2,
    }]),
    $transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work({
      temporalRelation: { create: relationCreate },
      temporalConsolidationCheckpoint: { updateMany: checkpointUpdate },
    })),
  };
  const llm = {
    chat: jest.fn()
      .mockResolvedValueOnce({
        model: 'configured-model',
        content: JSON.stringify({
          type: 'SUPERSEDES', subject: 'projeto Nebula', oldValue: null,
          newValue: 'Nebula 48', confidence: 0.95, reason: 'Nome alterado.',
        }),
      })
      .mockResolvedValueOnce({
        model: 'configured-model',
        content: JSON.stringify({
          type: 'SUPERSEDES', subject: 'projeto Nebula', oldValue: 'Nebula 47',
          newValue: 'Nebula 48', confidence: 0.95, reason: 'Mensagem posterior altera o nome.',
          predecessorMessageId: earlier.id,
        }),
      }),
  };
  const getApplicationSettings = jest.fn(async () => settings);
  const conversationRetrieval = {
    retrieve: jest.fn(async () => ({
      query: 'Nebula',
      results: [{ conversationId: earlier.conversationId, messages: [earlier] }],
    })),
  };
  const service = new TemporalConsolidationService(
    prisma as unknown as PrismaService,
    { getApplicationSettings } as unknown as SettingsService,
    llm as unknown as LlmService,
    conversationRetrieval as unknown as ConversationRetrievalService,
  );
  return { service, prisma, llm, settings, getApplicationSettings, conversationRetrieval, runCreate, runUpdate, relationCreate, checkpointUpdate };
}

async function waitForCompletion(update: jest.Mock): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (update.mock.calls.length) return update.mock.results[0].value as Promise<Record<string, unknown>>;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('background run did not finish');
}

describe('TemporalConsolidationService', () => {
  it('blocks manual runs and skips scheduled runs when disabled', async () => {
    const { service, prisma } = setup({ enabled: false });
    await expect(service.runManual()).rejects.toBeInstanceOf(ConflictException);
    await expect(service.runManual({ dryRun: true })).rejects.toBeInstanceOf(ConflictException);
    await expect(service.runScheduled()).resolves.toBeNull();
    expect(prisma.temporalConsolidationCheckpoint.upsert).not.toHaveBeenCalled();
  });

  it('cancels an active run before a model call when the toggle is disabled', async () => {
    const { service, settings, getApplicationSettings, runUpdate, llm, relationCreate } =
      setup({ messages: [later] });
    getApplicationSettings
      .mockResolvedValueOnce(settings)
      .mockResolvedValueOnce(settings)
      .mockResolvedValue({ ...settings, temporalConsolidationEnabled: false });
    await service.runManual();
    await waitForCompletion(runUpdate);
    expect(llm.chat).not.toHaveBeenCalled();
    expect(relationCreate).not.toHaveBeenCalled();
    expect(runUpdate.mock.calls[0][0].data).toMatchObject({
      status: 'cancelled', errorMessage: 'disabled', hasMore: true,
    });
  });

  it('uses the fallback combo intentionally for a manual run outside the window', async () => {
    const { service, runCreate, runUpdate } = setup();
    const response = await service.runManual();
    expect(response.run.status).toBe('running');
    expect(runCreate.mock.calls[0][0].data).toMatchObject({
      trigger: 'manual', actualCombo: 'configured-remote',
      fallbackUsed: true, fallbackReason: 'manual_outside_window',
    });
    await waitForCompletion(runUpdate);
  });

  it('finds an older antecedent and persists a message-level relation with its checkpoint', async () => {
    const { service, llm, relationCreate, runUpdate, checkpointUpdate } =
      setup({ messages: [later] });
    const response = await service.runManual();
    expect(response.run.status).toBe('running');
    await waitForCompletion(runUpdate);
    expect(llm.chat).toHaveBeenCalledTimes(2);
    expect(relationCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      predecessorMessageId: earlier.id,
      successorMessageId: later.id,
      oldValue: 'Nebula 47',
      newValue: 'Nebula 48',
    }) });
    expect(checkpointUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { lastMessageCreatedAt: later.createdAt, lastMessageId: later.id },
    }));
    expect(runUpdate.mock.calls[0][0].data).toMatchObject({
      status: 'completed', relationsCreated: 1, relationsProposed: 1,
      historicalRetrievalCalls: 1, chunksScanned: 1,
    });
  });

  it('retrieves a distant old value despite more than twelve intervening messages', async () => {
    const changed = {
      ...later,
      content: 'lembra do projeto nebula 47 ? agora se chama nebula 49',
      createdAt: new Date('2026-09-23T12:00:00Z'),
    };
    const { service, llm, prisma, conversationRetrieval, relationCreate, runUpdate } =
      setup({ messages: [changed] });
    const intervening = Array.from({ length: 20 }, (_, index) => ({
      ...earlier,
      id: `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`,
      content: `Outro assunto ${index}.`,
      createdAt: new Date(Date.UTC(2026, 8, 13 + index / 2)),
    }));
    conversationRetrieval.retrieve.mockResolvedValue({
      query: 'Nebula 47',
      results: [{ conversationId: earlier.conversationId, messages: intervening }],
    });
    prisma.$queryRaw.mockResolvedValue([{ ...earlier, score: 2 }]);
    llm.chat.mockReset()
      .mockResolvedValueOnce({ model: 'configured-model', content: JSON.stringify({
        type: 'SUPERSEDES', subject: 'projeto', oldValue: 'nebula 47',
        newValue: 'nebula 49', confidence: 0.95, reason: 'Nome alterado.',
      }) })
      .mockResolvedValueOnce({ model: 'configured-model', content: JSON.stringify({
        type: 'SUPERSEDES', subject: 'projeto', oldValue: 'Nebula 47',
        newValue: 'nebula 49', confidence: 0.95, reason: 'Novo nome explícito.',
        predecessorMessageId: earlier.id,
      }) });

    await service.runManual();
    await waitForCompletion(runUpdate);

    expect(conversationRetrieval.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'nebula 47', includeMessages: true, temporalMode: 'historical' }),
      expect.objectContaining({ currentMessageId: changed.id }),
      expect.objectContaining({ topK: 20, configOverrides: expect.objectContaining({ strategy: 'hybrid' }) }),
    );
    const validationInput = JSON.parse(llm.chat.mock.calls[1][0].messages[1].content) as {
      earlierMessages: Array<{ id: string }>;
    };
    expect(validationInput.earlierMessages).toContainEqual(expect.objectContaining({ id: earlier.id }));
    expect(validationInput.earlierMessages).toHaveLength(16);
    expect(relationCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      predecessorMessageId: earlier.id,
      successorMessageId: changed.id,
    }) });
  });

  it('accepts an explicit old value repeated across earlier conversations', async () => {
    const changed = {
      ...later,
      conversationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      content: 'lembra do projeto nebula 47 ? agora se chama nebula 49',
      createdAt: new Date('2026-09-23T12:00:00Z'),
    };
    const other = {
      ...earlier,
      id: '44444444-4444-4444-8444-444444444444',
      conversationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      createdAt: new Date('2026-09-21T12:00:00Z'),
    };
    const { service, llm, prisma, conversationRetrieval, relationCreate, runUpdate } =
      setup({ messages: [changed] });
    conversationRetrieval.retrieve.mockResolvedValue({
      query: 'Nebula 47',
      results: [
        { conversationId: earlier.conversationId, messages: [earlier] },
        { conversationId: other.conversationId, messages: [other] },
      ],
    });
    prisma.$queryRaw.mockResolvedValue([{ ...earlier, score: 2 }, { ...other, score: 2 }]);
    llm.chat.mockReset()
      .mockResolvedValueOnce({ model: 'configured-model', content: JSON.stringify({
        type: 'SUPERSEDES', subject: 'projeto', oldValue: 'nebula 47',
        newValue: 'nebula 49', confidence: 0.95, reason: 'Nome alterado.',
      }) })
      .mockResolvedValueOnce({ model: 'configured-model', content: JSON.stringify({
        type: 'SUPERSEDES', subject: 'projeto', oldValue: 'Nebula 47',
        newValue: 'nebula 49', confidence: 0.95, reason: 'Novo nome explícito.',
        predecessorMessageId: other.id,
      }) });

    await service.runManual();
    await waitForCompletion(runUpdate);

    expect(relationCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      predecessorMessageId: other.id,
      successorMessageId: changed.id,
    }) });
  });

  it('executes dry run without persisting a relation or advancing the checkpoint', async () => {
    const { service, relationCreate, checkpointUpdate, runUpdate } =
      setup({ messages: [later] });
    await service.runManual({ dryRun: true });
    await waitForCompletion(runUpdate);
    expect(relationCreate).not.toHaveBeenCalled();
    const checkpointWrites = checkpointUpdate.mock.calls.filter(([arg]) =>
      'lastMessageId' in (arg.data ?? {}),
    );
    expect(checkpointWrites).toHaveLength(0);
    expect(runUpdate.mock.calls[0][0].data).toMatchObject({
      status: 'completed', relationsCreated: 0, relationsProposed: 1,
    });
  });
});
