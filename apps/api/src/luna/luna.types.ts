import type { ChatMessage, LlmResponse } from "../llm/types/types";
import type { PersonalityIdentity } from './personality.service';
import type { selectMemoryContext } from '../memory/memory-context';
import type {
    OrchestratorContext,
    OrchestratorToolExecution,
} from "../orchestrator/orchestrator.types";

export type LunaGenerateInput = {
    context: OrchestratorContext;
    finalInstructions: string;
    toolExecutions: OrchestratorToolExecution[];
};

export type LunaGenerateResult = {
    response: LlmResponse;
    combo: string;
    promptMessages: ChatMessage[];
    personality: PersonalityIdentity;
    memory: Omit<ReturnType<typeof selectMemoryContext>, 'content'>;
};
