import { Module } from "@nestjs/common";
import { LlmModule } from "../llm/llm.module";
import { ToolsModule } from "../tools/tools.module";
import { OrchestratorService } from "./orchestrator.service";

@Module({
    imports: [LlmModule, ToolsModule],
    providers: [OrchestratorService],
    exports: [OrchestratorService],
})
export class OrchestratorModule {}
