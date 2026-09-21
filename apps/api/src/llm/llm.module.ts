import { Module } from "@nestjs/common";
import { OmnirouteModule } from "./omniroute/omniroute.module";
import { LlmService } from "./llm.service";
import { LlmController } from "./llm.controller";

@Module({
    imports: [OmnirouteModule],
    controllers: [LlmController],
    providers: [LlmService],
    exports: [LlmService],
})
export class LlmModule {}