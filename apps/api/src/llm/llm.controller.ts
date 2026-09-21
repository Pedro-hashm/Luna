import { Body, Controller, Post } from "@nestjs/common";
import type { LlmRequest } from "./dto/llm-request.dto";
import type { LlmResponse } from "./types/types";
import { LlmService } from "./llm.service";

@Controller("llm")
export class LlmController {
    constructor(private readonly llmService: LlmService) {}

    @Post("chat")
    async chat(@Body() llmRequest: LlmRequest): Promise<LlmResponse> {
        return this.llmService.chat(llmRequest);
    }
}