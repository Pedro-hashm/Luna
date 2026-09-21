import { Injectable } from "@nestjs/common";
import { LlmRequest } from "./dto/llm-request.dto";
import { LlmResponse } from "./types/types";
import { OmnirouteService } from "./omniroute/omniroute.service";

@Injectable()
export class LlmService {
    constructor(
        private readonly omnirouteService: OmnirouteService,
    ) {}
    
    async chat(llmRequest: LlmRequest): Promise<LlmResponse> {
        return this.omnirouteService.chat(llmRequest);
    }
}