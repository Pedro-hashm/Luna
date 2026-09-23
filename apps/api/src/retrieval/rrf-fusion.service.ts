import { Injectable } from '@nestjs/common';
import type { RetrievalCandidate } from './retrieval.types';

@Injectable()
export class ReciprocalRankFusion {
  fuse(
    vectorResults: RetrievalCandidate[],
    lexicalResults: RetrievalCandidate[],
    k: number,
  ): RetrievalCandidate[] {
    const byId = new Map<string, RetrievalCandidate>();

    const merge = (
      candidates: RetrievalCandidate[],
      channel: 'vector' | 'lexical',
    ) => {
      candidates.forEach((candidate, index) => {
        const rank = index + 1;
        const existing = byId.get(candidate.id) ?? {
          ...candidate,
          metadata: { ...candidate.metadata },
          retrievalPresence: [],
        };
        const presence = new Set(existing.retrievalPresence ?? []);

        if (channel === 'vector') {
          existing.vectorRank = candidate.vectorRank ?? rank;
          existing.vectorScore = candidate.vectorScore;
        } else {
          existing.lexicalRank = candidate.lexicalRank ?? rank;
          existing.lexicalScore = candidate.lexicalScore;
        }

        presence.add(channel);
        existing.retrievalPresence = [...presence].sort();
        existing.rrfScore = (existing.rrfScore ?? 0) + 1 / (k + rank);
        byId.set(candidate.id, existing);
      });
    };

    merge(vectorResults, 'vector');
    merge(lexicalResults, 'lexical');

    return [...byId.values()].sort(
      (left, right) =>
        (right.rrfScore ?? 0) - (left.rrfScore ?? 0) ||
        left.id.localeCompare(right.id),
    );
  }
}
