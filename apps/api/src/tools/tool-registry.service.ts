import { BadRequestException, Injectable } from "@nestjs/common";
import type {
    RegisteredTool,
    ToolDefinition,
} from "./tool-registry.types";
import type {
    ToolExecutionContext,
    ToolName,
} from "./types/tool.types";

@Injectable()
export class ToolRegistryService {
    private readonly tools = new Map<ToolName, RegisteredTool>();

    register(tool: RegisteredTool): void {
        if (this.tools.has(tool.name)) {
            throw new Error(`Tool already registered: ${tool.name}`);
        }

        this.tools.set(tool.name, tool);
    }

    has(name: string): name is ToolName {
        return this.tools.has(name as ToolName);
    }

    describe(): ToolDefinition[] {
        return [...this.tools.values()].map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
        }));
    }

    async execute(
        name: string,
        input: Record<string, unknown>,
        context: ToolExecutionContext,
    ) {
        const tool = this.tools.get(name as ToolName);

        if (!tool) {
            throw new BadRequestException(
                `Unknown tool: ${name || "(missing)"}`,
            );
        }

        return tool.execute(input, context);
    }
}
