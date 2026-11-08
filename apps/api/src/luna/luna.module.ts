import { Module } from "@nestjs/common";
import { LlmModule } from "../llm/llm.module";
import { LunaService } from "./luna.service";
import { PersonalityController } from "./personality.controller";
import { PersonalityService } from "./personality.service";

@Module({
    imports: [LlmModule],
    controllers: [PersonalityController],
    providers: [LunaService, PersonalityService],
    exports: [LunaService],
})
export class LunaModule {}
