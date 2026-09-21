import { Controller, Get, Param, Query } from "@nestjs/common";
import { ObservabilityService } from "./observability.service";
import type {
    ConversationInspector,
    ObservabilityMetrics,
} from "./observability.types";

@Controller("observability")
export class ObservabilityController {
    constructor(private readonly observabilityService: ObservabilityService) {}

    @Get("metrics")
    getMetrics(
        @Query("from") from?: string,
        @Query("to") to?: string,
    ): Promise<ObservabilityMetrics> {
        return this.observabilityService.getMetrics(from, to);
    }

    @Get("conversations/:conversationId")
    getConversationInspector(
        @Param("conversationId") conversationId: string,
    ): Promise<ConversationInspector> {
        return this.observabilityService.getConversationInspector(conversationId);
    }
}
