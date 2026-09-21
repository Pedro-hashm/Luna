export interface OmniRouteChoice {
    index: number;
    message: {
      role: 'assistant';
      content: string;
    };
    finish_reason: string | null;
}
  
export interface OmniRouteUsage {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
}