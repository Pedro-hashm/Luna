import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MessageRole } from '@prisma/client';
import { OmnirouteService } from '../src/llm/omniroute/omniroute.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  extractInput,
  TEMPORAL_EXTRACT_PROMPT,
  TEMPORAL_VALIDATE_PROMPT,
  validationInput,
} from '../src/temporal-consolidation/temporal-prompt';
import {
  parseExtractedChange,
  parseValidatedChange,
} from '../src/temporal-consolidation/temporal-structured-output';
import type { TemporalMessage } from '../src/temporal-consolidation/temporal-consolidation.types';

type EvaluationCase = {
  name: string;
  stage: 'extract' | 'validate';
  newer: TemporalMessage;
  earlier?: TemporalMessage[];
  proposed?: {
    type: string;
    subject: string;
    oldValue: string | null;
    newValue: string;
  };
  expected: {
    type: string;
    subject?: string;
    oldValue?: string | null;
    newValue?: string | null;
    predecessorMessageId?: string | null;
  };
};

const message = (id: string, content: string, date: string): TemporalMessage => ({
  id,
  conversationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  role: MessageRole.user,
  content,
  createdAt: new Date(date),
});

const old47 = message('11111111-1111-4111-8111-111111111111',
  'O projeto se chama Nebula 47.', '2026-09-01T12:00:00Z');
const old48 = message('22222222-2222-4222-8222-222222222222',
  'Mudamos o nome do projeto para Nebula 48.', '2026-09-08T12:00:00Z');
const oldPostgres = message('33333333-3333-4333-8333-333333333333',
  'Estamos usando PostgreSQL no backend.', '2026-09-01T12:00:00Z');
const newer47to48 = message('44444444-4444-4444-8444-444444444444',
  'Mudamos o nome. Agora é Nebula 48.', '2026-09-08T12:00:00Z');

const cases: EvaluationCase[] = [
  {
    name: 'explicit_change', stage: 'extract', newer: newer47to48,
    expected: { type: 'SUPERSEDES', subject: 'nome', oldValue: null, newValue: 'Nebula 48' },
  },
  {
    name: 'no_change', stage: 'extract',
    newer: message('55555555-5555-4555-8555-555555555555',
      'Hoje trabalhei no Nebula 47.', '2026-09-08T12:00:00Z'),
    expected: { type: 'NONE', oldValue: null, newValue: null },
  },
  {
    name: 'mention_without_relation', stage: 'extract',
    newer: message('66666666-6666-4666-8666-666666666666',
      'Hoje falei sobre o Nebula 48.', '2026-09-08T12:00:00Z'),
    expected: { type: 'NONE', oldValue: null, newValue: null },
  },
  {
    name: 'correction', stage: 'extract',
    newer: message('77777777-7777-4777-8777-777777777777',
      'Eu disse que era PostgreSQL, mas na verdade estamos usando SQLite.',
      '2026-09-08T12:00:00Z'),
    expected: { type: 'CORRECTS', oldValue: 'PostgreSQL', newValue: 'SQLite' },
  },
  {
    name: 'ambiguous_now', stage: 'extract',
    newer: message('88888888-8888-4888-8888-888888888888',
      'Estou olhando o Nebula 48 agora.', '2026-09-08T12:00:00Z'),
    expected: { type: 'NONE', oldValue: null, newValue: null },
  },
  {
    name: 'keyword_false_positive', stage: 'extract',
    newer: message('99999999-9999-4999-8999-999999999999',
      'Agora vamos falar sobre o projeto; o novo capítulo discute mudanças.',
      '2026-09-08T12:00:00Z'),
    expected: { type: 'NONE', oldValue: null, newValue: null },
  },
  {
    name: 'distant_antecedent', stage: 'validate', newer: message(
      'aaaaaaaa-1111-4111-8111-111111111111',
      'Mudamos o nome. Agora é Nebula 48.', '2026-09-28T12:00:00Z'),
    earlier: [old47],
    proposed: { type: 'SUPERSEDES', subject: 'nome do projeto Nebula', oldValue: null, newValue: 'Nebula 48' },
    expected: { type: 'SUPERSEDES', oldValue: 'Nebula 47', newValue: 'Nebula 48', predecessorMessageId: old47.id },
  },
  {
    name: 'correction_antecedent', stage: 'validate', newer: message(
      'aaaaaaaa-2222-4222-8222-222222222222',
      'Eu disse PostgreSQL, mas na verdade estamos usando SQLite.',
      '2026-09-08T12:00:00Z'),
    earlier: [oldPostgres],
    proposed: { type: 'CORRECTS', subject: 'banco de dados', oldValue: 'PostgreSQL', newValue: 'SQLite' },
    expected: { type: 'CORRECTS', oldValue: 'PostgreSQL', newValue: 'SQLite', predecessorMessageId: oldPostgres.id },
  },
  {
    name: 'chain_second_change', stage: 'validate', newer: message(
      'aaaaaaaa-3333-4333-8333-333333333333',
      'Mudamos de Nebula 48 para Nebula 49.', '2026-09-15T12:00:00Z'),
    earlier: [old47, old48],
    proposed: { type: 'SUPERSEDES', subject: 'nome do projeto Nebula', oldValue: 'Nebula 48', newValue: 'Nebula 49' },
    expected: { type: 'SUPERSEDES', oldValue: 'Nebula 48', newValue: 'Nebula 49', predecessorMessageId: old48.id },
  },
  {
    name: 'repeated_old_value_latest_anchor', stage: 'validate', newer: newer47to48,
    earlier: [old47, message('bbbbbbbb-1111-4111-8111-111111111111',
      'Confirmo: o projeto ainda se chama Nebula 47.', '2026-09-05T12:00:00Z')],
    proposed: { type: 'SUPERSEDES', subject: 'nome do projeto Nebula', oldValue: null, newValue: 'Nebula 48' },
    expected: { type: 'SUPERSEDES', oldValue: 'Nebula 47', newValue: 'Nebula 48', predecessorMessageId: 'bbbbbbbb-1111-4111-8111-111111111111' },
  },
];

async function main() {
  const outputIndex = process.argv.indexOf('--output');
  const reportPath = outputIndex >= 0 && process.argv[outputIndex + 1]
    ? resolve(process.argv[outputIndex + 1])
    : resolve(process.cwd(), '../../docs/conversation/temporal-prompt-evaluation.json');
  const report: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    source: 'synthetic controlled cases; no conversation data',
    promptVersion: 1,
    cases: [],
  };
  let prisma: PrismaService | undefined;
  try {
    const comboArgIndex = process.argv.indexOf('--combo');
    let combo = (comboArgIndex >= 0 ? process.argv[comboArgIndex + 1] : null)?.trim() ||
      process.env.TEMPORAL_EVAL_COMBO?.trim() || null;
    if (!combo) {
      prisma = new PrismaService();
      await prisma.$connect();
      const settings = await prisma.applicationSettings.findUnique({ where: { id: 1 } });
      combo = settings?.temporalConsolidationDefaultCombo ||
        settings?.temporalConsolidationFallbackCombo ||
        settings?.llmCombo || null;
    }
    if (!combo) throw new Error('No configured combo is available for prompt evaluation');
    report.combo = combo;
    const llm = new OmnirouteService();
    const onlyIndex = process.argv.indexOf('--only');
    const only = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : null;
    const selectedCases = only ? cases.filter((item) => item.name === only) : cases;
    for (const testCase of selectedCases) {
      const system = testCase.stage === 'extract' ? TEMPORAL_EXTRACT_PROMPT : TEMPORAL_VALIDATE_PROMPT;
      const input = testCase.stage === 'extract'
        ? extractInput(testCase.newer)
        : validationInput(testCase.newer, testCase.proposed!, testCase.earlier!);
      const item: Record<string, unknown> = {
        name: testCase.name,
        stage: testCase.stage,
        input,
        prompt: system,
        combo,
        expected: testCase.expected,
      };
      try {
        const response = await llm.chat({
          combo,
          messages: [{ role: 'system', content: system }, { role: 'user', content: input }],
          temperature: 0,
          maxTokens: 1600,
          signal: AbortSignal.timeout(45_000),
        });
        item.model = response.model;
        item.rawOutput = response.content;
        item.usage = response.usage;
        const normalized = testCase.stage === 'extract'
          ? parseExtractedChange(response.content)
          : parseValidatedChange(response.content);
        item.normalizedOutput = normalized;
        item.observed = {
          type: normalized.type,
          subject: normalized.subject,
          oldValue: normalized.oldValue,
          newValue: normalized.newValue,
          ...(testCase.stage === 'validate' && 'predecessorMessageId' in normalized
            ? { predecessorMessageId: normalized.predecessorMessageId }
            : {}),
        };
        item.passed = normalized.type === testCase.expected.type &&
          (testCase.expected.subject === undefined || normalized.subject === testCase.expected.subject) &&
          normalized.oldValue === testCase.expected.oldValue &&
          normalized.newValue === testCase.expected.newValue &&
          (testCase.stage === 'extract' ||
            ('predecessorMessageId' in normalized &&
              normalized.predecessorMessageId === testCase.expected.predecessorMessageId));
      } catch (error) {
        item.passed = false;
        item.error = error instanceof Error ? error.message : 'unknown error';
      }
      (report.cases as unknown[]).push(item);
    }
    report.status = (report.cases as Array<{ passed: boolean }>).every((item) => item.passed)
      ? 'passed' : 'failed';
  } catch (error) {
    report.status = 'unavailable';
    report.error = error instanceof Error ? error.message : 'unknown error';
  } finally {
    await prisma?.$disconnect();
    await mkdir(resolve(reportPath, '..'), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
    process.stdout.write(`${reportPath}\n${JSON.stringify({ status: report.status, combo: report.combo, error: report.error })}\n`);
  }
}

void main();
