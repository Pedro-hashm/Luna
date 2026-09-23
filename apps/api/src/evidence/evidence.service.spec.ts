import { EvidenceService } from './evidence.service';
import type { ConversationEvidenceReference } from '../tools/conversation-retrieval/types/conversation-retrieval.types';

describe('EvidenceService', () => {
  const reference = (
    chunkId: string,
    startAt: string,
    endAt: string,
    dates: string[],
  ): ConversationEvidenceReference => ({
    conversationId: `conversation-${chunkId}`,
    chunkId,
    startMessageId: `start-${chunkId}`,
    endMessageId: `end-${chunkId}`,
    messageIds: [`start-${chunkId}`, `end-${chunkId}`],
    startAt,
    endAt,
    dates,
  });

  it('creates one Evidence for a successful retrieval call with multiple source references and exact represented dates', async () => {
    const refs = [
      reference('chunk-a', '2026-09-13T02:00:00.000Z', '2026-09-13T02:30:00.000Z', ['2026-09-12']),
      reference('chunk-a2', '2026-09-13T04:00:00.000Z', '2026-09-13T04:30:00.000Z', ['2026-09-12']),
      reference('chunk-b', '2026-09-19T01:00:00.000Z', '2026-09-19T02:00:00.000Z', ['2026-09-18']),
    ];
    const create = jest.fn().mockImplementation(({ data }) => Promise.resolve({
      sequence: 7,
      dateFrom: data.dateFrom,
      dateTo: data.dateTo,
      dates: data.dates,
      timeZone: data.timeZone,
    }));
    const service = new EvidenceService({ conversationEvidence: { create } } as never);

    const created = await service.createForAssistantMessage({
      enabled: true,
      assistantMessageId: 'assistant-message-id',
      timeZone: 'America/Sao_Paulo',
      retrievalResults: [{ successful: true, hasResults: true, references: refs }],
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0].data).toMatchObject({
      messageId: 'assistant-message-id',
      dateFrom: new Date('2026-09-13T02:00:00.000Z'),
      dateTo: new Date('2026-09-19T02:00:00.000Z'),
      dates: ['2026-09-12', '2026-09-18'],
      timeZone: 'America/Sao_Paulo',
      sourceReferences: refs,
    });
    expect(created).toEqual([expect.objectContaining({
      evidence_id: 'ev_7',
      date_from: '2026-09-12',
      date_to: '2026-09-18',
      dates: ['2026-09-12', '2026-09-18'],
      referenceCount: 3,
    })]);
  });

  it('creates one Evidence per retrieval call, not per returned chunk', async () => {
    let sequence = 1;
    const create = jest.fn().mockImplementation(({ data }) => Promise.resolve({
      sequence: sequence++, dateFrom: data.dateFrom, dateTo: data.dateTo,
      dates: data.dates, timeZone: data.timeZone,
    }));
    const service = new EvidenceService({ conversationEvidence: { create } } as never);
    const one = reference('chunk-one', '2026-09-13T02:00:00Z', '2026-09-13T02:01:00Z', ['2026-09-12']);
    const two = reference('chunk-two', '2026-09-14T02:00:00Z', '2026-09-14T02:01:00Z', ['2026-09-13']);

    const created = await service.createForAssistantMessage({
      enabled: true, assistantMessageId: 'assistant-id', timeZone: 'America/Sao_Paulo',
      retrievalResults: [
        { successful: true, hasResults: true, references: [one, two] },
        { successful: true, hasResults: true, references: [reference('chunk-three', '2026-09-16T02:00:00Z', '2026-09-16T02:01:00Z', ['2026-09-15'])] },
      ],
    });

    expect(create).toHaveBeenCalledTimes(2);
    expect(created.map((evidence) => evidence.evidence_id)).toEqual(['ev_1', 'ev_2']);
    expect(created.map((evidence) => evidence.referenceCount)).toEqual([2, 1]);
  });

  it.each([
    ['empty results', false, [reference('chunk-a', '2026-09-13T02:00:00Z', '2026-09-13T02:30:00Z', ['2026-09-12'])]],
    ['failed retrieval', true, [reference('chunk-a', '2026-09-13T02:00:00Z', '2026-09-13T02:30:00Z', ['2026-09-12'])]],
    ['disabled setting', true, [reference('chunk-a', '2026-09-13T02:00:00Z', '2026-09-13T02:30:00Z', ['2026-09-12'])]],
    ['missing source references', true, []],
  ])('does not create Evidence for %s', async (caseName, hasResults, refs) => {
    const create = jest.fn();
    const service = new EvidenceService({ conversationEvidence: { create } } as never);
    const enabled = caseName !== 'disabled setting';

    await service.createForAssistantMessage({
      enabled,
      assistantMessageId: 'assistant-message-id',
      timeZone: 'America/Sao_Paulo',
      retrievalResults: [{ successful: caseName !== 'failed retrieval', hasResults, references: refs as ConversationEvidenceReference[] }],
    });

    expect(create).not.toHaveBeenCalled();
  });

  it('does not backfill old messages when re-enabled without a new retrieval result', async () => {
    const create = jest.fn();
    const service = new EvidenceService({ conversationEvidence: { create } } as never);

    await service.createForAssistantMessage({
      enabled: true,
      assistantMessageId: 'new-assistant-message',
      timeZone: 'America/Sao_Paulo',
      retrievalResults: [],
    });

    expect(create).not.toHaveBeenCalled();
  });

  it('resolves only a valid public Evidence ID and keeps its internal references backend-side', async () => {
    const refs = [reference('chunk-secret', '2026-09-13T02:00:00.000Z', '2026-09-13T02:30:00.000Z', ['2026-09-12'])];
    const findUnique = jest.fn().mockResolvedValue({
      id: 'internal-evidence-uuid', sequence: 12, messageId: 'assistant-id',
      sourceType: 'conversation_retrieval', dateFrom: new Date('2026-09-13T02:00:00.000Z'),
      dateTo: new Date('2026-09-13T02:30:00.000Z'), dates: ['2026-09-12'],
      timeZone: 'America/Sao_Paulo', sourceReferences: refs,
    });
    const service = new EvidenceService({ conversationEvidence: { findUnique } } as never);

    const resolved = await service.resolvePublicId('ev_12');

    expect(findUnique).toHaveBeenCalledWith({ where: { sequence: 12 } });
    expect(resolved?.publicView).toEqual({
      evidence_id: 'ev_12', date_from: '2026-09-12', date_to: '2026-09-12', dates: ['2026-09-12'],
    });
    expect(resolved?.sourceReferences[0]?.chunkId).toBe('chunk-secret');
    expect(await service.resolvePublicId('ev_0')).toBeUndefined();
    expect(await service.resolvePublicId('not-an-evidence-id')).toBeUndefined();
    expect(findUnique).toHaveBeenCalledTimes(1);
  });
});
