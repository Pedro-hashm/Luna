import { Module } from "@nestjs/common";
import { LlmModule } from "../llm/llm.module";
import { LunaService } from "./luna.service";

@Module({
    imports: [LlmModule],
    providers: [LunaService],
    exports: [LunaService],
})
export class LunaModule {}
