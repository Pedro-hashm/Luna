import { Injectable, Logger } from '@nestjs/common';
import { EvidenceService } from '../../evidence/evidence.service';
import type { ConversationContextDirection, ConversationContextResult } from '../../evidence/evidence.types';
import { ConversationChunkRetrievalProvider } from '../conversation-retrieval/conversation-chunk-retrieval.provider';
import { ToolArgumentException, ToolRuntimeContextException } from '../types/tool-errors';
import type { ToolExecutionContext } from '../types/tool.types';
import { SettingsService } from '../../settings/settings.service';
import { formatApplicationDateTime } from '../../time/application-time';

@Injectable()
export class ConversationContextService {
  private readonly logger = new Logger(ConversationContextService.name);

  constructor(
    private readonly evidenceService: EvidenceService,
    private readonly source: ConversationChunkRetrievalProvider,
    private readonly settingsService: SettingsService,
  ) {}

  async expand(
    evidenceId: string,
    direction: ConversationContextDirection,
    _context: ToolExecutionContext,
  ): Promise<ConversationContextResult> {
    const startedAt = Date.now();
    const settings = await this.settingsService.getApplicationSettings();
    if (!settings.conversationEvidenceEnabled) {
      throw new ToolRuntimeContextException('Conversation Evidence is disabled.');
    }

    const evidence = await this.evidenceService.resolvePublicId(evidenceId);
    if (!evidence) {
      throw new ToolArgumentException('evidence_id', 'The requested Evidence is unavailable.');
    }

    const expanded = await Promise.all(evidence.sourceReferences.map((reference) =>
      this.source.expandEvidenceReference(reference, direction, 5),
    ));
    const messages = new Map<string, { id: string; role: string; content: string; createdAt: Date }>();
    for (const group of expanded) {
      for (const message of group) messages.set(message.id, message);
    }

    const ordered = [...messages.values()].sort((a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
    );
    const maxTokens = Math.min(
      settings.retrievalDefaultMaxContextTokens,
      settings.orchestratorToolResultMaxTokens,
    );
    let remaining = maxTokens;
    const results: ConversationContextResult['results'] = [];
    for (const message of ordered) {
      if (remaining <= 0) break;
      const prefix = `${message.role}: `;
      const maxCharacters = remaining * 4 - prefix.length;
      if (maxCharacters <= 0) break;
      const content = message.content.length > maxCharacters
        ? `${message.content.slice(0, Math.max(1, maxCharacters - 1)).trimEnd()}…`
        : message.content;
      const renderedTokens = Math.max(1, Math.ceil((prefix.length + content.length) / 4));
      results.push({
        date: formatApplicationDateTime(message.createdAt, settings.appTimezone).slice(0, 10),
        role: message.role,
        content,
      });
      remaining -= renderedTokens;
    }

    const latencyMs = Date.now() - startedAt;
    const result: ConversationContextResult = {
      evidence_id: evidence.publicView.evidence_id,
      direction,
      results,
      resultCount: results.length,
    };
    Object.defineProperty(result, '__evidenceDiagnostics', {
      enumerable: false,
      value: {
        event: 'evidence.resolve',
        evidenceId: evidence.publicView.evidence_id,
        direction,
        referenceCount: evidence.sourceReferences.length,
        resultCount: results.length,
        latencyMs,
      },
    });
    this.logger.log(JSON.stringify({
      event: 'evidence.resolve',
      evidenceId: evidence.publicView.evidence_id,
      direction,
      referenceCount: evidence.sourceReferences.length,
      resultCount: results.length,
      latencyMs,
    }));
    return result;
  }
}
