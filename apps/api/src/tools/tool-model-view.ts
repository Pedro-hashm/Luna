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
      ? 'evidence_id' in execution.result
        ? toConversationContextModelResult(execution.result)
        : toConversationRetrievalModelResult(execution.result)
      : undefined,
    error: execution.error,
  };
}

function toConversationRetrievalModelResult(
  result: Extract<ToolExecutionResult, { query: string | null }>,
): Record<string, unknown> {
  return {
    query: result.query,
    results: result.results.map((item) => ({
      status: item.status,
      tokenCount: item.tokenCount,
      timeRange: item.timeRange,
      content: item.content,
      tailContent: item.tailContent,
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
