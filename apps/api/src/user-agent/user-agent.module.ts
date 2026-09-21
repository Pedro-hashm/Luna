import { Module } from "@nestjs/common";
import { LunaModule } from "../luna/luna.module";
import { OrchestratorModule } from "../orchestrator/orchestrator.module";
import { ContextManagerService } from "./context-manager/context-manager.service";
import { UserAgentService } from "./user-agent.service";

@Module({
    imports: [OrchestratorModule, LunaModule],
    providers: [UserAgentService, ContextManagerService],
    exports: [UserAgentService, ContextManagerService],
})
export class UserAgentModule {}
