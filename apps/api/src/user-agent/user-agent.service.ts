import { Injectable } from "@nestjs/common";
import { LunaService } from "../luna/luna.service";
import { OrchestratorService } from "../orchestrator/orchestrator.service";
import type {
    UserAgentInitialState,
    UserAgentRunResult,
    UserAgentState,
} from "./types/user-agent.types";

@Injectable()
export class UserAgentService {
    constructor(
        private readonly orchestratorService: OrchestratorService,
        private readonly lunaService: LunaService,
    ) {}

    async run(initial: UserAgentInitialState): Promise<UserAgentRunResult> {
        const startedAt = Date.now();
        const state = this.createState(initial);
        const orchestratorStartedAt = Date.now();
        const orchestrator = await this.orchestratorService.execute({
            requestId: state.requestId,
            input: state.input,
            conversationId: state.conversationId,
            currentDateTime: state.currentDateTime,
            recentMessages: state.recentMessages,
            memory: state.memory,
            preferences: state.preferences,
            runtime: state.runtime,
        });
        const orchestratorMs = Date.now() - orchestratorStartedAt;
        const lunaStartedAt = Date.now();
        const luna = await this.lunaService.generate({
            context: orchestrator.context,
            finalInstructions: orchestrator.finalInstructions,
            toolExecutions: orchestrator.toolExecutions,
        });

        return {
            state,
            orchestrator,
            luna,
            timings: {
                orchestratorMs,
                lunaMs: Date.now() - lunaStartedAt,
                totalMs: Date.now() - startedAt,
            },
        };
    }

    private createState(initial: UserAgentInitialState): UserAgentState {
        return {
            ...initial,
            recentMessages: [...initial.recentMessages],
            memory: { items: [] },
            preferences: {},
            runtime: {},
        };
    }
}
