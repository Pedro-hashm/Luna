import type { ConversationRetrievalResult } from './conversation-retrieval/types/conversation-retrieval.types';
import { isRuntimeOwnedToolArgument } from './tool-argument-ownership';
import type { ToolExecutionError } from './types/tool.types';

type ToolExecutionForModel = {
  tool: string;
  arguments: Record<string, unknown>;
  status: 'success' | 'error';
  result?: ConversationRetrievalResult;
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
      ? toConversationRetrievalModelResult(execution.result)
      : undefined,
    error: execution.error,
  };
}

function toConversationRetrievalModelResult(
  result: ConversationRetrievalResult,
): Record<string, unknown> {
  return {
    query: result.query,
    results: result.results.map((item) => ({
      status: item.status,
      score: item.score,
      tokenCount: item.tokenCount,
      content: item.content,
      tailContent: item.tailContent,
      messages: item.messages?.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    })),
  };
}
