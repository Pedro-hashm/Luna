import { Module } from '@nestjs/common';
import { OmnirouteModule } from '../llm/omniroute/omniroute.module';
import { ResearchController } from './research.controller';
import { ResearchConfigService } from './research-config.service';
import { ResearchEvidenceService } from './evidence/research-evidence.service';
import { ResearchRunService } from './research-run.service';
import { SearchOrchestratorService } from './search-orchestrator.service';
import { SearchPlannerService } from './search-planner.service';
import { SearxngProvider } from './providers/search/searxng.provider';
import { SEARCH_PROVIDER } from './providers/search/search-provider';
import { SourceService } from './sources/source.service';
import { WebSearchTool } from './tools/web-search.tool';
import { ExtractionModule } from './providers/extraction/extraction.module';

@Module({
  imports: [OmnirouteModule, ExtractionModule],
  controllers: [ResearchController],
  providers: [
    ResearchConfigService,
    ResearchRunService,
    SearchPlannerService,
    SearchOrchestratorService,
    SourceService,
    ResearchEvidenceService,
    SearxngProvider,
    { provide: SEARCH_PROVIDER, useExisting: SearxngProvider },
    WebSearchTool,
  ],
  exports: [SearchOrchestratorService],
})
export class ResearchModule {}
