import { isRuntimeOwnedToolArgument } from './tool-argument-ownership';
import type { ToolExecutionError, ToolExecutionResult } from './types/tool.types';

type ToolExecutionForModel = {
  tool: string;
  arguments: Record<string, unknown>;
  status: 'success' | 'error';
  result?: ToolExecutionResult;
  error?: ToolExecutionError;
};

/**
 * Creates the representation of a tool execution that may be sent to a model.
 * Internal identifiers remain available to persistence and observability, but
 * never become values the model is expected to copy into a later tool call.
 */
export function toToolExecutionModelView(
  execution: ToolExecutionForModel,
): Record<string, unknown> {
  return {
    tool: execution.tool,
    arguments: Object.fromEntries(
      Object.entries(execution.arguments).filter(
        ([key]) => !isRuntimeOwnedToolArgument(key),
      ),
    ),
    status: execution.status,
    result: execution.result
      ? 'researchRunId' in execution.result
        ? toWebResearchModelResult(execution.result)
        : 'evidence_id' in execution.result
        ? toConversationContextModelResult(execution.result)
        : toConversationRetrievalModelResult(execution.result)
      : undefined,
    error: execution.error,
  };
}

function toWebResearchModelResult(
  result: Extract<ToolExecutionResult, { researchRunId: string }>,
): Record<string, unknown> {
  const sourceKeys = ['sourceId', 'id', 'title', 'url', 'domain', 'sourceType', 'publishedAt', 'retrievedAt'];
  const evidenceKeys = ['id', 'sourceId', 'text', 'location', 'type'];
  const pick = (value: unknown, keys: string[]): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const record = value as Record<string, unknown>;
    return Object.fromEntries(keys.filter((key) => record[key] !== undefined).map((key) => [key, record[key]]));
  };

  return {
    status: result.status,
    summaryContext: result.summaryContext.slice(0, 4000),
    sources: result.sources.slice(0, 12).map((source) => pick(source, sourceKeys)),
    evidence: result.evidence.slice(0, 20).map((item) => {
      const value = pick(item, evidenceKeys);
      if (typeof value.text === 'string') value.text = value.text.slice(0, 800);
      return value;
    }),
    conflicts: result.conflicts.slice(0, 8),
    metadata: pick(result.metadata, ['rounds', 'searchQueries', 'sourceCount']),
  };
}

function toConversationRetrievalModelResult(
  result: Extract<ToolExecutionResult, { query: string | null }>,
): Record<string, unknown> {
  return {
    query: result.query,
    temporalMode: result.temporalMode,
    results: result.results.map((item) => ({
      status: item.status,
      tokenCount: item.tokenCount,
      timeRange: item.timeRange,
      content: item.content,
      tailContent: item.tailContent,
      temporalChanges: item.temporalChanges?.map((change) => ({
        status: 'superseded',
        subject: change.subject,
        type: change.type,
        oldValue: change.oldValue,
        newValue: change.newValue,
        chainComplete: change.chainComplete,
        successors: change.successors.map((successor) => ({
          role: successor.role,
          content: successor.content,
          createdAt: successor.createdAt,
          type: successor.type,
          newValue: successor.newValue,
        })),
      })),
      messages: item.messages?.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    })),
  };
}

function toConversationContextModelResult(
  result: Extract<ToolExecutionResult, { evidence_id: string }>,
): Record<string, unknown> {
  return {
    evidence_id: result.evidence_id,
    direction: result.direction,
    resultCount: result.resultCount,
    results: result.results.map((item) => ({
      date: item.date,
      role: item.role,
      content: item.content,
    })),
  };
}
