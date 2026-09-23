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

    estimateMessagesTokens(messages: Array<Pick<RuntimeMessage, "role" | "content"> & Pick<RuntimeMessage, "evidence">>): number {
        return messages.reduce(
            (total, message) => total + this.estimateMessageTokens(message),
            0,
        );
    }

    estimateMessageTokens(
        message: Pick<RuntimeMessage, "role" | "content"> & Pick<RuntimeMessage, "evidence">,
    ): number {
        const evidence = message.role === "assistant" && message.evidence?.length
            ? `\nEvidence: ${JSON.stringify(message.evidence)}`
            : "";
        return this.estimateTokens(`${message.role}: ${message.content}${evidence}`);
    }

    estimateTokens(content: string): number {
        return content ? Math.max(1, Math.ceil(content.length / 4)) : 0;
    }

    private truncateMessage(
        message: RuntimeMessage,
        maxTokens: number,
    ): RuntimeMessage {
        let evidence = message.evidence;
        while (evidence?.length && this.estimateMessageTokens({ ...message, evidence }) > maxTokens) {
            evidence = evidence.slice(1);
        }
        const evidenceTokens = evidence?.length
            ? this.estimateTokens(`\nEvidence: ${JSON.stringify(evidence)}`)
            : 0;
        const rolePrefixLength = `${message.role}: `.length;
        const maxCharacters = Math.max(1, (maxTokens - evidenceTokens) * 4 - rolePrefixLength);

        if (message.content.length <= maxCharacters) {
            return evidence === message.evidence ? message : { ...message, evidence };
        }

        return {
            ...message,
            evidence,
            content: `${message.content
                .slice(0, Math.max(1, maxCharacters - 1))
                .trimEnd()}…`,
        };
    }
}
