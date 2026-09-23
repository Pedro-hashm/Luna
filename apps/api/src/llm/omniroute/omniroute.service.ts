import { Injectable, Logger } from "@nestjs/common";

import { LlmRequest } from "../dto/llm-request.dto";
import { LlmResponse } from "../types/types";
import { OmniRouteResponse } from "./types/omni-route-response";

@Injectable()
export class OmnirouteService {
    private readonly baseUrl = (
        process.env.OMNIROUTE_BASE_URL ?? "http://localhost:20128/v1"
    ).replace(/\/$/u, "");
    private readonly logger = new Logger(OmnirouteService.name);

    async chat(
        llmRequest: LlmRequest
    ): Promise<LlmResponse> {
        const requestBody = JSON.stringify({
            model: llmRequest.combo,
            messages: llmRequest.messages,
            temperature: llmRequest.temperature,
            max_tokens: llmRequest.maxTokens,
            ...(llmRequest.reasoningEffort
                ? { reasoning_effort: llmRequest.reasoningEffort }
                : {}),
        });

        this.logger.debug(`OmniRoute request: combo=${llmRequest.combo}, messages=${llmRequest.messages.length}, bytes=${requestBody.length}`);

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: requestBody,
            signal: llmRequest.signal,
        });

        if (!response.ok) {
            const detail = (await response.text()).trim();
            const safeDetail = detail.slice(0, 2_000);

            throw new Error(
                `Failed to fetch chat completions: ${response.status} ${response.statusText}` +
                    (safeDetail ? ` - ${safeDetail}` : ""),
            );
        }

        const omniRouteResponse =
            (await response.json()) as OmniRouteResponse;

        const choice = omniRouteResponse.choices[0];

        return {
            content: choice.message.content,
            model: omniRouteResponse.model,
            usage: omniRouteResponse.usage
                ? {
                      inputTokens: omniRouteResponse.usage.prompt_tokens,
                      outputTokens: omniRouteResponse.usage.completion_tokens,
                      totalTokens: omniRouteResponse.usage.total_tokens,
                  }
                : undefined,
        };
    }
}
