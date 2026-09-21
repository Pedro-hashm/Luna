import type { ChatMessage, LlmResponse } from "../llm/types/types";
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
};
