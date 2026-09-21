import type { RuntimeMessage } from '../user-agent/types/user-agent.types';
import type { ConversationRetrievalResult } from '../tools/conversation-retrieval/types/conversation-retrieval.types';

export type OrchestratorContext = {
  requestId: string;
  input: string;
  conversationId: string;
  currentDateTime: string;
  recentMessages: RuntimeMessage[];
  memory: {
    items: unknown[];
  };
  preferences: Record<string, unknown>;
  runtime: Record<string, unknown>;
};

export type OrchestratorToolExecution = {
  iteration: number;
  tool: string;
  arguments: Record<string, unknown>;
  status: 'success' | 'error';
  result?: ConversationRetrievalResult;
  error?: string;
};

export type OrchestratorDecisionRecord = {
  iteration: number;
  type: 'tool_call' | 'finalize' | 'safety_limit';
  tool?: string;
  status: 'accepted' | 'fallback' | 'rejected';
};

export type OrchestratorResult = {
  context: OrchestratorContext;
  toolExecutions: OrchestratorToolExecution[];
  decisions: OrchestratorDecisionRecord[];
  iterationCount: number;
  finalInstructions: string;
};

export type OrchestratorDecision =
  | {
      type: 'tool_call';
      tool: string;
      arguments: Record<string, unknown>;
    }
  | {
      type: 'finalize';
    };
