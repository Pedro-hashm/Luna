import type { TemporalRelationType } from '@prisma/client';

export type ExtractedChange = {
  type: TemporalRelationType | 'NONE';
  subject: string | null;
  oldValue: string | null;
  newValue: string | null;
  confidence: number;
  reason: string;
};

export type ValidatedChange = ExtractedChange & {
  predecessorMessageId: string | null;
};

export class InvalidTemporalOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTemporalOutputError';
  }
}

function parseObject(raw: string): Record<string, unknown> {
  const stripped = raw.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  let value: unknown;
  try {
    value = JSON.parse(stripped);
  } catch {
    throw new InvalidTemporalOutputError('invalid structured output: JSON parse failed');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidTemporalOutputError('invalid structured output: object expected');
  }
  return value as Record<string, unknown>;
}

function optionalText(value: unknown, key: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 500) {
    throw new InvalidTemporalOutputError(`invalid structured output: ${key}`);
  }
  const normalized = value.trim();
  return normalized.toLowerCase() === 'null' ? null : normalized || null;
}

export function parseExtractedChange(raw: string): ExtractedChange {
  const value = parseObject(raw);
  if (!['NONE', 'SUPERSEDES', 'CORRECTS'].includes(String(value.type))) {
    throw new InvalidTemporalOutputError('invalid structured output: type');
  }
  if (typeof value.confidence !== 'number' || value.confidence < 0 || value.confidence > 1) {
    throw new InvalidTemporalOutputError('invalid structured output: confidence');
  }
  const subject = optionalText(value.subject, 'subject');
  const oldValue = optionalText(value.oldValue, 'oldValue');
  const newValue = optionalText(value.newValue, 'newValue');
  const reason = optionalText(value.reason, 'reason') ?? '';
  // The new message can establish a concrete change without naming its
  // property. Historical validation must still identify the subject.
  if (value.type !== 'NONE' && !newValue) {
    throw new InvalidTemporalOutputError('invalid structured output: missing change fields');
  }
  return {
    type: value.type as ExtractedChange['type'],
    subject,
    oldValue,
    newValue,
    confidence: value.confidence,
    reason,
  };
}

export function parseValidatedChange(raw: string): ValidatedChange {
  const value = parseObject(raw);
  const base = parseExtractedChange(raw);
  const predecessorMessageId = optionalText(value.predecessorMessageId, 'predecessorMessageId');
  if (base.type !== 'NONE' && (!predecessorMessageId || !base.oldValue || !base.subject)) {
    throw new InvalidTemporalOutputError('invalid structured output: missing validated change fields');
  }
  return { ...base, predecessorMessageId };
}
