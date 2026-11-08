import { Injectable, Optional } from '@nestjs/common';
import { MemoryService } from '../memory/memory.service';
import { asksAboutMemory } from '../memory/memory.types';
import { LunaService } from '../luna/luna.service';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import type {
  UserAgentInitialState,
  UserAgentRunResult,
  UserAgentState,
} from './types/user-agent.types';

@Injectable()
export class UserAgentService {
  constructor(
    private readonly orchestratorService: OrchestratorService,
    private readonly lunaService: LunaService,
    @Optional() private readonly memory?: MemoryService,
  ) {}

  async run(initial: UserAgentInitialState): Promise<UserAgentRunResult> {
    const startedAt = Date.now();
    const state = this.createState(initial);
    if (this.memory) {
      const settings = await this.memory.settings();
      state.runtime.memoryEnabled = settings.enabled;
    }
    const orchestratorStartedAt = Date.now();
    const orchestrator = await this.orchestratorService.execute({
      requestId: state.requestId,
      input: state.input,
      conversationId: state.conversationId,
      currentMessageId: state.currentMessageId,
      currentDateTime: state.currentDateTime,
      recentMessages: state.recentMessages,
      memory: state.memory,
      preferences: state.preferences,
      runtime: state.runtime,
    });
    const orchestratorMs = Date.now() - orchestratorStartedAt;
    if (this.memory) {
      const settings = await this.memory.settings();
      state.runtime.memoryEnabled = settings.enabled;
      state.runtime.memorySuggestionsEnabled = settings.enabled && settings.suggestionsEnabled;
      state.runtime.memoryAllowExplicitUse = settings.allowExplicitUse;
      if (settings.enabled && asksAboutMemory(initial.input)) {
        const previous = state.recentMessages.findLast(message => message.role === 'user' && message.id !== initial.currentMessageId);
        if (previous) state.runtime.previousMemoryReview = await this.memory.reviewStatus(previous.id);
      }
      state.memory = await this.memory.fixed(initial.currentDateTime.slice(0, 10), settings);
      orchestrator.context.memory = state.memory;
    }
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
      runtime: { outputMode: initial.outputMode ?? 'text' },
    };
  }
}
