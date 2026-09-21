export type ChatMessage = {
    role: "system" | "user" | "assistant" | "tool";
    content: string;
}

export interface LlmResponse {
    content: string;
    model: string;
    usage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
}