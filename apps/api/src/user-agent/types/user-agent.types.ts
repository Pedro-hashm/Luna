import type { ChatMessage } from '../../llm/types/types';
import type { LunaGenerateResult } from '../../luna/luna.types';
import type { OrchestratorResult } from '../../orchestrator/orchestrator.types';
import type { FixedMemory } from '../../memory/memory-context';

export type RuntimeMessage = ChatMessage & {
  id: string;
  createdAt: string;
  evidence?: ConversationEvidenceView[];
};

export type ConversationEvidenceView = {
  evidence_id: string;
  date_from: string;
  date_to: string;
  dates: string[];
};

export type UserAgentInitialState = {
  requestId: string;
  input: string;
  conversationId: string;
  currentMessageId: string;
  currentDateTime: string;
  recentMessages: RuntimeMessage[];
  outputMode?: 'text' | 'voice';
  memoryScope?: string;
  conversationSource?: string;
};

export type UserAgentState = UserAgentInitialState & {
  memory: FixedMemory;
  preferences: Record<string, unknown>;
  runtime: Record<string, unknown>;
};

export type UserAgentRunResult = {
  state: UserAgentState;
  orchestrator: OrchestratorResult;
  luna: LunaGenerateResult;
  timings: {
    orchestratorMs: number;
    lunaMs: number;
    totalMs: number;
  };
};
