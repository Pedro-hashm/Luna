import { Controller, Get, Param } from '@nestjs/common';
import { ResearchRunService } from './research-run.service';

@Controller('research')
export class ResearchController {
  constructor(private readonly runs: ResearchRunService) {}

  @Get('runs/:runId')
  getRun(@Param('runId') runId: string) {
    return this.runs.get(runId);
  }

  @Get('conversations/:conversationId/runs')
  getConversationRuns(@Param('conversationId') conversationId: string) {
    return this.runs.listForConversation(conversationId);
  }
}
