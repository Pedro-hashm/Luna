import { ToolArgumentException, ToolRuntimeContextException } from '../types/tool-errors';
import { ConversationContextService } from './conversation-context.service';

const reference = {
  conversationId: 'conversation-internal-id',
  chunkId: 'chunk-internal-id',
  startMessageId: 'message-start-id',
  endMessageId: 'message-end-id',
  messageIds: ['message-start-id', 'message-end-id'],
  startAt: '2026-09-12T12:00:00.000Z',
  endAt: '2026-09-12T12:05:00.000Z',
  dates: ['2026-09-12'],
};

describe('ConversationContextService', () => {
  function createHarness(enabled = true, resolved: unknown = {
    publicView: { evidence_id: 'ev_1' },
    sourceReferences: [reference],
  }) {
    const evidence = { resolvePublicId: jest.fn().mockResolvedValue(resolved) };
    const source = {
      expandEvidenceReference: jest.fn().mockResolvedValue([
        { id: 'private-message-id', role: 'user', content: 'Antes da decisão', createdAt: new Date('2026-09-12T12:01:00.000Z') },
      ]),
    };
    const settings = {
      getApplicationSettings: jest.fn().mockResolvedValue({
        conversationEvidenceEnabled: enabled,
        retrievalDefaultMaxContextTokens: 1000,
        orchestratorToolResultMaxTokens: 1000,
        appTimezone: 'America/Sao_Paulo',
      }),
    };
    return {
      service: new ConversationContextService(evidence as never, source as never, settings as never),
      evidence,
      source,
    };
  }

  it.each(['before', 'after', 'both'] as const)('expands deterministically in the %s direction', async (direction) => {
    const harness = createHarness();
    const result = await harness.service.expand('ev_1', direction, { messages: [] });

    expect(harness.evidence.resolvePublicId).toHaveBeenCalledWith('ev_1');
    expect(harness.source.expandEvidenceReference).toHaveBeenCalledWith(reference, direction, 5);
    expect(result).toMatchObject({ evidence_id: 'ev_1', direction, resultCount: 1 });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(reference.conversationId);
    expect(serialized).not.toContain(reference.chunkId);
    expect(serialized).not.toContain(reference.startMessageId);
    expect(serialized).not.toContain('private-message-id');
    expect(result.__evidenceDiagnostics).toMatchObject({
      event: 'evidence.resolve', evidenceId: 'ev_1', direction, referenceCount: 1, resultCount: 1,
    });
  });

  it('returns a controlled error for an unknown public Evidence ID', async () => {
    const harness = createHarness(true, null);

    await expect(harness.service.expand('ev_999', 'before', { messages: [] }))
      .rejects.toBeInstanceOf(ToolArgumentException);
    expect(harness.source.expandEvidenceReference).not.toHaveBeenCalled();
  });

  it('rejects direct use while Evidence is disabled', async () => {
    const harness = createHarness(false);

    await expect(harness.service.expand('ev_1', 'both', { messages: [] }))
      .rejects.toBeInstanceOf(ToolRuntimeContextException);
    expect(harness.evidence.resolvePublicId).not.toHaveBeenCalled();
  });
});
