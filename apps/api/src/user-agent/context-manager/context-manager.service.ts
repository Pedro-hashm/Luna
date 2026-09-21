import { Injectable } from "@nestjs/common";
import type { RuntimeMessage } from "../types/user-agent.types";

@Injectable()
export class ContextManagerService {
    buildRecentMessages(
        messages: RuntimeMessage[],
        maxTokens: number,
    ): RuntimeMessage[] {
        if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
            throw new Error("Immediate context maxTokens must be a positive integer");
        }

        const selected: RuntimeMessage[] = [];
        let remainingTokens = maxTokens;

        for (let index = messages.length - 1; index >= 0; index -= 1) {
            const message = messages[index];
            const messageTokens = this.estimateMessageTokens(message);

            if (messageTokens <= remainingTokens) {
                selected.push(message);
                remainingTokens -= messageTokens;
                continue;
            }

            // Keep the latest message even if it alone is larger than the
            // budget. This is an exceptional case, but preserves the current
            // user input while ensuring the outbound context stays bounded.
            if (selected.length === 0) {
                selected.push(this.truncateMessage(message, maxTokens));
            }

            break;
        }

        return selected.reverse();
    }

    estimateMessagesTokens(messages: Array<Pick<RuntimeMessage, "role" | "content">>): number {
        return messages.reduce(
            (total, message) => total + this.estimateMessageTokens(message),
            0,
        );
    }

    estimateMessageTokens(
        message: Pick<RuntimeMessage, "role" | "content">,
    ): number {
        return this.estimateTokens(`${message.role}: ${message.content}`);
    }

    estimateTokens(content: string): number {
        return content ? Math.max(1, Math.ceil(content.length / 4)) : 0;
    }

    private truncateMessage(
        message: RuntimeMessage,
        maxTokens: number,
    ): RuntimeMessage {
        const rolePrefixLength = `${message.role}: `.length;
        const maxCharacters = Math.max(1, maxTokens * 4 - rolePrefixLength);

        if (message.content.length <= maxCharacters) {
            return message;
        }

        return {
            ...message,
            content: `${message.content
                .slice(0, Math.max(1, maxCharacters - 1))
                .trimEnd()}…`,
        };
    }
}
