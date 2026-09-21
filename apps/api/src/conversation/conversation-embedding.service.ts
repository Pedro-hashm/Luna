import {
    Injectable,
    Logger,
    ServiceUnavailableException,
} from "@nestjs/common";

interface OllamaEmbeddingResponse {
    embeddings?: unknown;
}

@Injectable()
export class ConversationEmbeddingService {
    private readonly logger = new Logger(ConversationEmbeddingService.name);
    private readonly baseUrl = (
        process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"
    ).replace(/\/$/u, "");

    async embed(
        content: string,
        model: string,
        dimensions: number,
    ): Promise<number[]> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60_000);

        try {
            const response = await fetch(`${this.baseUrl}/api/embed`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                signal: controller.signal,
                body: JSON.stringify({ model, input: content }),
            });
            const payload = (await response.json().catch(() => undefined)) as
                | OllamaEmbeddingResponse
                | undefined;
            const vector = this.firstVector(payload?.embeddings);

            if (!response.ok || !vector) {
                throw new Error(`Embedding provider returned ${response.status}`);
            }

            if (
                vector.length !== dimensions ||
                vector.some((value) => !Number.isFinite(value))
            ) {
                throw new Error(
                    `Embedding provider returned ${vector.length} dimensions; expected ${dimensions}`,
                );
            }

            return vector;
        } catch (error) {
            this.logger.warn(
                `Embedding request failed: ${
                    error instanceof Error ? error.message : "unknown error"
                }`,
            );
            throw new ServiceUnavailableException(
                "The conversation embedding provider is unavailable.",
            );
        } finally {
            clearTimeout(timeout);
        }
    }

    toVectorLiteral(vector: number[]): string {
        return `[${vector.join(",")}]`;
    }

    private firstVector(value: unknown): number[] | undefined {
        if (!Array.isArray(value) || value.length === 0) {
            return undefined;
        }

        const vector = value[0];

        if (
            !Array.isArray(vector) ||
            vector.some(
                (entry) =>
                    typeof entry !== "number" || !Number.isFinite(entry),
            )
        ) {
            return undefined;
        }

        return vector;
    }
}
