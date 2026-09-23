import { Injectable } from '@nestjs/common';
import type { RetrievalCandidate } from './retrieval.types';

@Injectable()
export class RetrievalResultCompiler {
  compile(
    candidates: RetrievalCandidate[],
    limit: number,
    maxContextTokens: number,
  ): { candidates: RetrievalCandidate[]; excludedBy: Map<string, string> } {
    const selected: RetrievalCandidate[] = [];
    const excludedBy = new Map<string, string>();
    let remaining = maxContextTokens;

    for (const candidate of candidates) {
      if (selected.length >= limit) {
        excludedBy.set(candidate.id, 'final_top_k');
        continue;
      }

      const tokens = this.estimateTokens(candidate.content);
      if (remaining <= 0) {
        excludedBy.set(candidate.id, 'context_budget');
        continue;
      }

      if (tokens > remaining) {
        const truncated = this.truncate(candidate.content, remaining);
        if (!truncated) {
          excludedBy.set(candidate.id, 'context_budget');
          continue;
        }
        selected.push({ ...candidate, content: truncated });
        remaining = 0;
        continue;
      }

      selected.push(candidate);
      remaining -= tokens;
    }

    return { candidates: selected, excludedBy };
  }

  private estimateTokens(content: string): number {
    return content ? Math.max(1, Math.ceil(content.length / 4)) : 0;
  }

  private truncate(content: string, tokenLimit: number): string {
    if (!content || tokenLimit <= 0) return '';
    const maxCharacters = tokenLimit * 4;
    if (content.length <= maxCharacters) return content;
    return `${content.slice(0, Math.max(1, maxCharacters - 1)).trimEnd()}…`;
  }
}
