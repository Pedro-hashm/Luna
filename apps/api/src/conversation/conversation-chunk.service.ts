import { Injectable } from "@nestjs/common";
import {
    ConversationChunkStatus,
    MessageRole,
    type ConversationChunk,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ConversationEmbeddingService } from "./conversation-embedding.service";

type ChunkMessage = {
    id: string;
    role: MessageRole;
    content: string;
};

type ChunkSettings = {
    maxTokens: number;
    overlapTokens: number;
    embeddingRefreshTokens: number;
    embeddingModel: string;
    embeddingDimensions: number;
};

type TailProcessingResult = {
    openChunk?: ConversationChunk;
    closedChunk?: ConversationChunk;
    nextMessageIndex: number;
};

@Injectable()
export class ConversationChunkService {
    private readonly synchronizationLocks = new Map<string, Promise<void>>();

    constructor(
        private readonly prisma: PrismaService,
        private readonly embeddingService: ConversationEmbeddingService,
    ) {}

    async synchronizeConversation(conversationId: string): Promise<void> {
        const previous =
            this.synchronizationLocks.get(conversationId) ?? Promise.resolve();
        const current = previous
            .catch(() => undefined)
            .then(() => this.synchronizeConversationLocked(conversationId));

        this.synchronizationLocks.set(conversationId, current);

        try {
            await current;
        } finally {
            if (this.synchronizationLocks.get(conversationId) === current) {
                this.synchronizationLocks.delete(conversationId);
            }
        }
    }

    private async synchronizeConversationLocked(
        conversationId: string,
    ): Promise<void> {
        const settings = await this.getSettings();
        const messages = await this.prisma.message.findMany({
            where: { conversationId },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: {
                id: true,
                role: true,
                content: true,
            },
        });

        if (messages.length === 0) {
            return;
        }

        const chunks = await this.prisma.conversationChunk.findMany({
            where: { conversationId },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });

        let openChunk = [...chunks]
            .reverse()
            .find((chunk) => chunk.status === ConversationChunkStatus.open);
        let latestClosedChunk = [...chunks]
            .reverse()
            .find((chunk) => chunk.status === ConversationChunkStatus.closed);

        if (openChunk) {
            const indexedEndIndex = this.messageIndex(
                messages,
                openChunk.endMessageId,
            );
            const result = await this.processOpenTail(
                openChunk,
                messages,
                indexedEndIndex + 1,
                settings,
            );
            openChunk = result.openChunk;
            latestClosedChunk = result.closedChunk ?? latestClosedChunk;
        }

        let nextMessageIndex = openChunk
            ? this.messageIndex(messages, openChunk.endMessageId) + 1
            : latestClosedChunk
              ? this.messageIndex(messages, latestClosedChunk.endMessageId) + 1
              : 0;

        while (nextMessageIndex < messages.length) {
            if (!openChunk) {
                if (latestClosedChunk) {
                    const overlapMessages = this.selectOverlapMessages(
                        messages,
                        this.messageIndex(
                            messages,
                            latestClosedChunk.startMessageId,
                        ),
                        this.messageIndex(
                            messages,
                            latestClosedChunk.endMessageId,
                        ),
                        settings.overlapTokens,
                    );

                    if (overlapMessages.length > 0) {
                        openChunk = await this.createOpenChunk(
                            conversationId,
                            overlapMessages,
                            settings,
                        );
                    } else {
                        openChunk = await this.createOpenChunk(
                            conversationId,
                            [messages[nextMessageIndex]],
                            settings,
                        );
                        nextMessageIndex += 1;
                    }
                } else {
                    openChunk = await this.createOpenChunk(
                        conversationId,
                        [messages[nextMessageIndex]],
                        settings,
                    );
                    nextMessageIndex += 1;

                    if (openChunk.tokenCount >= settings.maxTokens) {
                        latestClosedChunk = await this.closeChunk(
                            openChunk,
                            openChunk.content,
                            openChunk.endMessageId,
                            openChunk.tokenCount,
                            settings,
                        );
                        openChunk = undefined;
                    }
                }
            }

            if (openChunk && openChunk.tokenCount >= settings.maxTokens) {
                latestClosedChunk = await this.closeChunk(
                    openChunk,
                    openChunk.content,
                    openChunk.endMessageId,
                    openChunk.tokenCount,
                    settings,
                );
                openChunk = undefined;
                continue;
            }

            if (!openChunk) {
                continue;
            }

            const indexedEndIndex = this.messageIndex(
                messages,
                openChunk.endMessageId,
            );
            const result = await this.processOpenTail(
                openChunk,
                messages,
                Math.max(nextMessageIndex, indexedEndIndex + 1),
                settings,
            );

            openChunk = result.openChunk;
            latestClosedChunk = result.closedChunk ?? latestClosedChunk;
            nextMessageIndex = result.nextMessageIndex;
        }
    }

    private async processOpenTail(
        chunk: ConversationChunk,
        messages: ChunkMessage[],
        firstTailIndex: number,
        settings: ChunkSettings,
    ): Promise<TailProcessingResult> {
        let currentChunk = chunk;
        let indexedEndIndex = this.messageIndex(
            messages,
            currentChunk.endMessageId,
        );
        let indexedContent = currentChunk.content;
        let indexedTokenCount = this.estimateTokens(indexedContent);

        if (firstTailIndex >= messages.length) {
            if (currentChunk.tokenCount !== indexedTokenCount) {
                currentChunk = await this.updateTokenCount(
                    currentChunk,
                    indexedTokenCount,
                );
            }

            return {
                openChunk: currentChunk,
                nextMessageIndex: messages.length,
            };
        }

        for (
            let messageIndex = firstTailIndex;
            messageIndex < messages.length;
            messageIndex += 1
        ) {
            const message = messages[messageIndex];
            const tailMessages = messages.slice(
                indexedEndIndex + 1,
                messageIndex + 1,
            );
            const candidateContent = this.joinMessages(
                indexedContent,
                tailMessages,
            );
            const candidateTokenCount = this.estimateTokens(candidateContent);
            const messageTokens = this.estimateTokens(
                this.formatMessage(message),
            );
            const wouldExceedLimit =
                candidateTokenCount > settings.maxTokens;
            const messageNeedsMoreThanAvailable =
                messageTokens > settings.maxTokens - settings.overlapTokens;

            if (
                wouldExceedLimit &&
                !messageNeedsMoreThanAvailable &&
                messageIndex > indexedEndIndex
            ) {
                const finalEndIndex = messageIndex - 1;
                const finalTail = messages.slice(
                    indexedEndIndex + 1,
                    messageIndex,
                );
                const finalContent = this.joinMessages(
                    indexedContent,
                    finalTail,
                );
                const finalTokenCount = this.estimateTokens(finalContent);
                const closedChunk = await this.closeChunk(
                    currentChunk,
                    finalContent,
                    messages[finalEndIndex].id,
                    finalTokenCount,
                    settings,
                );

                return {
                    closedChunk,
                    nextMessageIndex: messageIndex,
                };
            }

            if (candidateTokenCount >= settings.maxTokens) {
                const closedChunk = await this.closeChunk(
                    currentChunk,
                    candidateContent,
                    message.id,
                    candidateTokenCount,
                    settings,
                );

                return {
                    closedChunk,
                    nextMessageIndex: messageIndex + 1,
                };
            }

            currentChunk = await this.updateTokenCount(
                currentChunk,
                candidateTokenCount,
            );

            if (
                candidateTokenCount - indexedTokenCount >=
                settings.embeddingRefreshTokens
            ) {
                currentChunk = await this.refreshEmbedding(
                    currentChunk,
                    candidateContent,
                    message.id,
                    candidateTokenCount,
                    settings,
                );
                indexedContent = candidateContent;
                indexedEndIndex = messageIndex;
                indexedTokenCount = candidateTokenCount;
            }
        }

        return {
            openChunk: currentChunk,
            nextMessageIndex: messages.length,
        };
    }

    private async getSettings(): Promise<ChunkSettings> {
        const settings = await this.prisma.conversationChunkSettings.upsert({
            where: { id: 1 },
            update: {},
            create: { id: 1 },
        });

        if (
            settings.maxTokens <= 0 ||
            settings.overlapTokens < 0 ||
            settings.overlapTokens >= settings.maxTokens ||
            settings.embeddingRefreshTokens <= 0 ||
            settings.embeddingDimensions !== 1024
        ) {
            throw new Error("Invalid conversation chunk settings");
        }

        return settings;
    }

    private async createOpenChunk(
        conversationId: string,
        messages: ChunkMessage[],
        settings: ChunkSettings,
    ): Promise<ConversationChunk> {
        const content = this.joinMessages("", messages);
        const tokenCount = this.estimateTokens(content);
        const chunk = await this.prisma.conversationChunk.create({
            data: {
                conversationId,
                content,
                startMessageId: messages[0].id,
                endMessageId: messages[messages.length - 1].id,
                status: ConversationChunkStatus.open,
                tokenCount,
            },
        });

        return this.refreshEmbedding(
            chunk,
            content,
            messages[messages.length - 1].id,
            tokenCount,
            settings,
        );
    }

    private async updateTokenCount(
        chunk: ConversationChunk,
        tokenCount: number,
    ): Promise<ConversationChunk> {
        if (chunk.tokenCount === tokenCount) {
            return chunk;
        }

        return this.prisma.conversationChunk.update({
            where: { id: chunk.id },
            data: { tokenCount },
        });
    }

    private async closeChunk(
        chunk: ConversationChunk,
        content: string,
        endMessageId: string,
        tokenCount: number,
        settings: ChunkSettings,
    ): Promise<ConversationChunk> {
        const indexedChunk = await this.refreshEmbedding(
            chunk,
            content,
            endMessageId,
            tokenCount,
            settings,
        );

        return this.prisma.conversationChunk.update({
            where: { id: indexedChunk.id },
            data: { status: ConversationChunkStatus.closed },
        });
    }

    private async refreshEmbedding(
        chunk: ConversationChunk,
        content: string,
        endMessageId: string,
        tokenCount: number,
        settings: ChunkSettings,
    ): Promise<ConversationChunk> {
        const vector = await this.embeddingService.embed(
            content,
            settings.embeddingModel,
            settings.embeddingDimensions,
        );
        const vectorLiteral = this.embeddingService.toVectorLiteral(vector);

        await this.prisma.$executeRawUnsafe(
            `UPDATE "conversation_chunks"
             SET "content" = $1,
                 "embedding" = $2::vector,
                 "end_message_id" = $3::uuid,
                 "token_count" = $4
             WHERE "id" = $5::uuid`,
            content,
            vectorLiteral,
            endMessageId,
            tokenCount,
            chunk.id,
        );

        return {
            ...chunk,
            content,
            endMessageId,
            tokenCount,
        };
    }

    private selectOverlapMessages(
        messages: ChunkMessage[],
        startIndex: number,
        endIndex: number,
        overlapTokens: number,
    ): ChunkMessage[] {
        if (startIndex < 0 || endIndex < startIndex) {
            return [];
        }

        const selected: ChunkMessage[] = [];
        let tokenCount = 0;

        for (let index = endIndex; index >= startIndex; index -= 1) {
            const message = messages[index];
            selected.unshift(message);
            tokenCount += this.estimateTokens(this.formatMessage(message));

            if (tokenCount >= overlapTokens) {
                break;
            }
        }

        return selected;
    }

    private joinMessages(
        baseContent: string,
        messages: ChunkMessage[],
    ): string {
        const additions = messages.map((message) =>
            this.formatMessage(message),
        );

        return [baseContent, ...additions].filter(Boolean).join("\n");
    }

    private messageIndex(messages: ChunkMessage[], messageId: string): number {
        const index = messages.findIndex((message) => message.id === messageId);

        if (index < 0) {
            throw new Error(`Message ${messageId} was not found in conversation`);
        }

        return index;
    }

    private formatMessage(message: ChunkMessage): string {
        return `${message.role}: ${message.content}`;
    }

    private estimateTokens(content: string): number {
        return Math.max(1, Math.ceil(content.length / 4));
    }
}
