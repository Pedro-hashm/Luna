import { Injectable } from '@nestjs/common';
import type { RetrievalCandidate } from './retrieval.types';

@Injectable()
export class ResultDeduplicator {
  deduplicate(
    candidates: RetrievalCandidate[],
    threshold: number,
  ): { candidates: RetrievalCandidate[]; removedIds: string[] } {
    const kept: RetrievalCandidate[] = [];
    const removedIds: string[] = [];

    for (const candidate of candidates) {
      const duplicate = kept.some(
        (previous) =>
          previous.id === candidate.id ||
          this.sameMessageRange(previous, candidate) ||
          this.contentSimilarity(previous.content, candidate.content) >=
            threshold,
      );

      if (duplicate) {
        removedIds.push(candidate.id);
      } else {
        kept.push(candidate);
      }
    }

    return { candidates: kept, removedIds };
  }

  private sameMessageRange(
    left: RetrievalCandidate,
    right: RetrievalCandidate,
  ): boolean {
    if (left.source !== right.source) return false;
    const leftStart = left.metadata.startMessageId;
    const leftEnd = left.metadata.endMessageId;
    const rightStart = right.metadata.startMessageId;
    const rightEnd = right.metadata.endMessageId;
    return Boolean(
      (leftStart && leftStart === rightStart && leftEnd === rightEnd) ||
        (leftStart && leftStart === rightEnd && leftEnd === rightStart),
    );
  }

  private contentSimilarity(left: string, right: string): number {
    const leftTokens = this.tokenSet(left);
    const rightTokens = this.tokenSet(right);
    if (!leftTokens.size || !rightTokens.size) return 0;

    let intersection = 0;
    for (const token of leftTokens) {
      if (rightTokens.has(token)) intersection += 1;
    }
    return intersection / (leftTokens.size + rightTokens.size - intersection);
  }

  private tokenSet(content: string): Set<string> {
    return new Set(
      content
        .toLocaleLowerCase('pt-BR')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/gu, '')
        .match(/[\p{L}\p{N}_-]+/gu) ?? [],
    );
  }
}
