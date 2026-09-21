import { ChatMessage } from "../types/types";

export interface LlmRequest {
    combo: string;
    messages: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
}