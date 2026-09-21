import { Body, Controller, Post } from "@nestjs/common";
import { ToolsService } from "./tools.service";
import type {
    ExecuteToolRequest,
    ExecuteToolResponse,
} from "./types/tool.types";

@Controller("tools")
export class ToolsController {
    constructor(private readonly toolsService: ToolsService) {}

    @Post("execute")
    execute(
        @Body() request: ExecuteToolRequest,
    ): Promise<ExecuteToolResponse> {
        return this.toolsService.execute(request);
    }
}
