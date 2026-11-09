import type { DiscordParticipant, RuntimeMessage } from '../user-agent/types/user-agent.types';
import type { ToolExecutionError, ToolExecutionResult } from '../tools/types/tool.types';
import type { ConversationEvidenceReference } from '../tools/conversation-retrieval/types/conversation-retrieval.types';
import type { FixedMemory } from '../memory/memory-context';

export type OrchestratorContext = {
  requestId: string;
  input: string;
  conversationId: string;
  currentMessageId: string;
  currentDateTime: string;
  recentMessages: RuntimeMessage[];
  discordParticipant?: DiscordParticipant;
  memory: FixedMemory;
  preferences: Record<string, unknown>;
  runtime: Record<string, unknown>;
};

export type OrchestratorToolExecution = {
  iteration: number;
  tool: string;
  arguments: Record<string, unknown>;
  status: 'success' | 'error';
  result?: ToolExecutionResult;
  evidenceReferences?: ConversationEvidenceReference[];
  error?: ToolExecutionError;
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
