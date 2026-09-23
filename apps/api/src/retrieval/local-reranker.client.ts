import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { RetrievalCandidate, RerankerModel } from './retrieval.types';

export type LocalRerankerModelStatus = {
  id: RerankerModel;
  installed: boolean;
  loaded: boolean;
  status: 'not_installed' | 'downloading' | 'installed' | 'loading' | 'loaded' | 'failed';
  error?: string;
  bytes?: number;
};

type SidecarModel = Omit<LocalRerankerModelStatus, 'id'> & { key: string };
type SidecarRerankResponse = {
  model: string;
  results: Array<{ index: number; relevanceScore: number }>;
};

const MODEL_KEYS: Record<RerankerModel, string> = {
  'cross-encoder/ettin-reranker-17m-v1': 'ettin-17m',
  'qwen3-reranker-0.6b-q8_0': 'qwen3-0.6b-q8_0',
};

@Injectable()
export class LocalRerankerClient {
  private readonly logger = new Logger(LocalRerankerClient.name);
  private readonly baseUrl = (
    process.env.RETRIEVAL_RERANKER_URL ?? 'http://localhost:8200'
  ).replace(/\/$/u, '');

  async getModels(): Promise<{
    available: boolean;
    models: LocalRerankerModelStatus[];
  }> {
    try {
      const payload = await this.request<{ available?: boolean; models?: SidecarModel[] }>(
        '/models',
        { method: 'GET' },
        5_000,
      );
      const byKey = new Map((payload.models ?? []).map((model) => [model.key, model]));
      return {
        available: payload.available ?? true,
        models: (Object.entries(MODEL_KEYS) as [RerankerModel, string][]).map(
          ([id, key]) => {
            const model = byKey.get(key);
            return {
              id,
              installed: model?.installed ?? false,
              loaded: model?.loaded ?? false,
              status: model?.status ?? 'not_installed',
              error: model?.error,
              bytes: model?.bytes,
            };
          },
        ),
      };
    } catch (error) {
      this.logger.warn(
        `Local reranker status unavailable: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return {
        available: false,
        models: (Object.entries(MODEL_KEYS) as [RerankerModel, string][]).map(
          ([id]) => ({
            id,
            installed: false,
            loaded: false,
            status: 'not_installed',
            error: 'Local reranker service unavailable',
          }),
        ),
      };
    }
  }

  async download(model: RerankerModel): Promise<{ status: string; model: RerankerModel }> {
    const result = await this.request<{ status: string }>(
      `/models/${MODEL_KEYS[model]}/download`,
      { method: 'POST' },
      10_000,
    );
    return { status: result.status, model };
  }

  async rerank(
    query: string,
    candidates: RetrievalCandidate[],
    model: RerankerModel,
  ): Promise<RetrievalCandidate[]> {
    const result = await this.request<SidecarRerankResponse>(
      '/rerank',
      {
        method: 'POST',
        body: JSON.stringify({
          model: MODEL_KEYS[model],
          query,
          documents: candidates.map((candidate) => candidate.content),
        }),
      },
      120_000,
    );
    const scored = result.results
      .filter(
        (entry) =>
          Number.isInteger(entry.index) &&
          candidates[entry.index] !== undefined &&
          Number.isFinite(entry.relevanceScore),
      )
      .map((entry) => ({
        candidate: candidates[entry.index],
        score: entry.relevanceScore,
      }))
      .sort(
        (left, right) =>
          right.score - left.score || left.candidate.id.localeCompare(right.candidate.id),
      );

    return scored.map(({ candidate, score }) => ({
      ...candidate,
      rerankerScore: score,
    }));
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', ...init.headers },
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => undefined)) as
        | (T & { detail?: string; error?: string })
        | undefined;
      if (!response.ok || !payload) {
        const detail = payload?.detail ?? payload?.error ?? `HTTP ${response.status}`;
        throw new Error(detail);
      }
      return payload;
    } catch (error) {
      throw new ServiceUnavailableException(
        `Local reranker service failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
