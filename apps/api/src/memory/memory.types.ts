import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';

export const MEMORY_KINDS = ['profile', 'preference', 'project', 'relationship', 'event'] as const;
export const MEMORY_OPERATIONS = ['add', 'change', 'correct'] as const;
export const MEMORY_PROMPT_PREFIX = 'Personal memory data for this reply:';
export const MEMORY_TOOLS = ['memory_search', 'memory_save', 'memory_forget'] as const;
const REMEMBER = /^(?:luna[,\s]+)?(?:(?:lembre(?:-se)?|lembra)\s+(?:que|de guardar|disso|disto)|guarde|guarda|salve|salva|memorize|anote|(?:corrija|atualize)\s+(?:(?:na|a)\s+)?mem[oó]ria)\b/iu;
const CHAT_SCOPE = /\b(?:n(?:est|ess)[ae]|(?:para|durante)\s+(?:est|ess)[ae])\s+(?:conversa|chat|contexto|turno|sessao)\b/u;
export const FORGET = /^(?:luna[,\s]+)?(?:esque[cç]a|esquece|apague da mem[oó]ria|remova da mem[oó]ria)\b/iu;

export type Draft = {
  subject: string;
  predicate: string;
  scope: string;
  kind: (typeof MEMORY_KINDS)[number];
  value: string;
  validFrom: string | null;
  operation: (typeof MEMORY_OPERATIONS)[number];
};
export type MemoryHit = {
  id: string; revision: number; subject: string; predicate: string; scope: string;
  value: string; validFrom: string | null; validTo: string | null;
};
export type MemoryResult = {
  memory: 'search' | 'save' | 'forget';
  items: MemoryHit[];
  outcome?: 'saved' | 'saved-private' | 'forgotten';
};

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Dados inválidos.');
  return value as Record<string, unknown>;
}

export function bounded(value: unknown, label: string, size: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > size) {
    throw new BadRequestException(label + ' deve ter entre 1 e ' + size + ' caracteres.');
  }
  return value.trim();
}

export function flag(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new BadRequestException('Controle inválido.');
  return value;
}

export function day(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new BadRequestException('Use uma data válida no formato AAAA-MM-DD.');
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new BadRequestException('Data inválida.');
  return value;
}

export function normal(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR').trim().replace(/\s+/gu, ' ');
}

export function isChatOnlyMemoryRequest(content: string) {
  return REMEMBER.test(content) && CHAT_SCOPE.test(normal(content));
}

export function isExplicitMemorySave(content: string) {
  return REMEMBER.test(content) && !CHAT_SCOPE.test(normal(content));
}

export function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function sourceFingerprint(messageId: string, value: string) {
  return 'source:' + hash(JSON.stringify([messageId, normal(value)]));
}

export function memoryKey(draft: Pick<Draft, 'subject' | 'predicate' | 'scope'>): string {
  return hash(JSON.stringify([draft.subject, draft.predicate, draft.scope].map(normal)));
}

export function readDraft(value: unknown): Draft {
  const v = object(value);
  const draft = {
    subject: bounded(v.subject, 'Assunto', 80),
    predicate: bounded(v.predicate, 'Relação', 80),
    scope: v.scope ? bounded(v.scope, 'Escopo', 80) : 'global',
    kind: v.kind,
    value: bounded(v.value, 'Memória', 500),
    validFrom: day(v.validFrom),
    operation: v.operation ?? 'add',
  };
  if (!(MEMORY_KINDS as readonly unknown[]).includes(draft.kind) ||
      !(MEMORY_OPERATIONS as readonly unknown[]).includes(draft.operation)) {
    throw new BadRequestException('Categoria ou operação de memória inválida.');
  }
  if ([draft.subject, draft.predicate, draft.scope, draft.value].some(looksLikeSecret)) {
    throw new BadRequestException('Credenciais não podem ser guardadas como memória.');
  }
  if (normal(draft.scope) === 'global') draft.scope = 'global';
  return draft as Draft;
}

export function looksLikeSecret(value: string) {
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|ghp|github_pat|xoxb)[-_][\w-]{12,}|\b(?:senha|password|api[_ -]?key|access[_ -]?token)(?:\s*[:=]\s*|\s+(?:é|is)\s+)\S+/iu.test(value);
}

export function isMemoryTool(tool: string) {
  return (MEMORY_TOOLS as readonly string[]).includes(tool);
}

export function memoryReferences(hits: MemoryHit[], reason: string) {
  return hits.map(({ id, revision }) => ({ id, revision, reason }));
}

export function redactMemoryExecution<T extends { tool: string; arguments: Record<string, unknown>; result?: unknown }>(execution: T) {
  if (!isMemoryTool(execution.tool)) return execution;
  const result = execution.result as MemoryResult | undefined;
  return {
    ...execution,
    arguments: {},
    result: result ? { action: result.memory, outcome: result.outcome, references: memoryReferences(result.items, 'busca') } : undefined,
  };
}

export function redactMemoryPrompt<T extends { content: string }>(messages: T[]): T[] {
  return messages.map(message => message.content.startsWith(MEMORY_PROMPT_PREFIX)
    ? { ...message, content: MEMORY_PROMPT_PREFIX + ' [conteúdo omitido do trace]' }
    : message);
}
