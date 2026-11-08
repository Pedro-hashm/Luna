import { ConflictException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryService } from './memory.service';
import { allowsAutomaticMemory, bounded, looksLikeSecret, normal, object, readDraft } from './memory.types';
import { declaredNames } from './declared-name';
import { extractMemories } from './memory-extractor';

const BATCH = 8;

@Injectable()
export class MemoryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MemoryWorker.name);
  private interval?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly prisma: PrismaService, private readonly memory: MemoryService) {}

  onModuleInit() {
    this.interval = setInterval(() => {
      void this.run(false).catch(() => this.logger.warn('Memory batch failed; pending jobs will be retried.'));
    }, 45_000);
    this.interval.unref();
  }

  onModuleDestroy() {
    if (this.interval) clearInterval(this.interval);
  }

  async run(manual: boolean) {
    if (this.running) {
      if (manual) throw new ConflictException('Já há uma análise em andamento.');
      return { examined: 0, saved: 0 };
    }
    this.running = true;
    try {
      return await this.process(manual);
    } finally {
      this.running = false;
    }
  }

  private async process(manual: boolean) {
    const settings = await this.memory.settings();
    if (!settings.enabled || !settings.suggestionsEnabled) {
      if (manual) throw new ConflictException('Ative a análise de mensagens novas primeiro.');
      return { examined: 0, saved: 0 };
    }
    const now = new Date();
    const leaseToken = randomUUID();
    const available = {
      done: false, attempts: { lt: 3 },
      ...(manual ? {} : { availableAt: { lte: now } }),
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
    };
    const jobs = await this.prisma.$transaction(async (tx) => {
      const waiting = await tx.memoryJob.findMany({ where: available, orderBy: [{ availableAt: 'asc' }, { messageId: 'asc' }], take: BATCH });
      if (!waiting.length) return [];
      await tx.memoryJob.updateMany({
        where: { ...available, messageId: { in: waiting.map(job => job.messageId) } },
        data: { leaseToken, leaseUntil: new Date(now.getTime() + 120_000), attempts: { increment: 1 } },
      });
      return tx.memoryJob.findMany({
        where: { leaseToken },
        orderBy: [{ availableAt: 'asc' }, { messageId: 'asc' }],
        include: { message: { select: { id: true, conversationId: true, role: true, content: true, createdAt: true } } },
      });
    });
    if (!jobs.length) return { examined: 0, saved: 0 };

    try {
      const deadline = AbortSignal.timeout(85_000);
      const processed: Array<{ message: typeof jobs[number]['message']; candidates: unknown[] }> = [];
      const failed: string[] = [];
      for (const { message } of jobs) {
        try {
          const candidates = message.role === 'user' && message.content.trim().length >= 12 &&
            allowsAutomaticMemory(message.content)
            ? await this.candidatesFor(message, deadline)
            : [];
          processed.push({ message, candidates });
        } catch {
          failed.push(message.id);
        }
      }

      const result = await this.prisma.$transaction(async (tx) => {
        const settings = await tx.memorySettings.findUniqueOrThrow({ where: { id: 1 } });
        if (!settings.enabled || !settings.suggestionsEnabled) {
          await tx.memoryJob.updateMany({ where: { leaseToken }, data: { leaseToken: null, leaseUntil: null, attempts: { decrement: 1 } } });
          return { saved: 0, candidates: 0 };
        }
        let saved = 0;
        let proposed = 0;
        for (const { message, candidates } of processed) {
          if (!await tx.memoryJob.findFirst({ where: { messageId: message.id, leaseToken } })) continue;
          proposed += candidates.length;
          for (const candidate of candidates) {
            const grounded = this.ground(candidate, message.content);
            if (grounded && await this.memory.saveAutomatic(tx, grounded.draft, message, grounded.quote)) saved++;
          }
        }
        await tx.memoryJob.updateMany({
          where: { leaseToken, messageId: { in: processed.map(({ message }) => message.id) } },
          data: { done: true, leaseToken: null, leaseUntil: null },
        });
        await tx.memoryJob.updateMany({
          where: { leaseToken, messageId: { in: failed } },
          data: { leaseToken: null, leaseUntil: null, availableAt: new Date(Date.now() + 60_000) },
        });
        return { saved, candidates: proposed };
      }, { isolationLevel: 'Serializable' });
      this.logger.log(JSON.stringify({ examined: processed.length, ...result, failed: failed.length }));
      if (manual && failed.length && !processed.length) {
        throw new ConflictException('O modelo local de memória não concluiu a análise. A fila foi preservada.');
      }
      return { examined: processed.length, saved: result.saved };
    } catch {
      await this.prisma.memoryJob.updateMany({
        where: { leaseToken },
        data: { leaseToken: null, leaseUntil: null, availableAt: new Date(Date.now() + 60_000) },
      });
      if (manual) throw new ConflictException('O modelo local de memória não concluiu a análise. A fila foi preservada.');
      this.logger.warn('Local memory extraction unavailable; pending jobs will be retried.');
      return { examined: 0, saved: 0 };
    }
  }

  private async candidatesFor(
    message: { id: string; conversationId: string; content: string }, deadline: AbortSignal,
  ) {
    const names = declaredNames(message.content);
    if (names.length) return names;
    deadline.throwIfAborted();
    const previous = await this.prisma.message.findMany({
      where: { conversationId: message.conversationId },
      cursor: { id: message.id },
      skip: 1,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 2,
      select: { role: true, content: true },
    });
    const context = previous.reverse().filter(({ content }) => !looksLikeSecret(content))
      .map(({ role, content }) => ({ role, content: content.slice(0, 400) }));
    return extractMemories(message.content.slice(0, 1800), context,
      AbortSignal.any([deadline, AbortSignal.timeout(35_000)]));
  }

  private ground(candidate: unknown, source: string) {
    try {
      const raw = object(candidate);
      let draft = readDraft(raw);
      let quote = literalQuote(source, bounded(raw.quote, 'Fonte', 1000));
      if (!quote) return;
      const quoteStart = source.indexOf(quote);
      if (!normal(quote).includes(normal(draft.value))) {
        // A valid quote can stop partway through a longer literal value.
        const valueStart = source.indexOf(draft.value);
        const quoteEnd = quoteStart + quote.length;
        const valueEnd = valueStart + draft.value.length;
        if (valueStart >= 0 && valueStart < quoteEnd && quoteStart < valueEnd) {
          quote = source.slice(Math.min(quoteStart, valueStart), Math.max(quoteEnd, valueEnd));
          if (quote.length > 1000) return;
        } else {
          if (quote.length > 180 || draft.operation !== 'add') return;
          draft = { ...draft, value: quote };
        }
      }
      return { draft, quote };
    } catch {
      return;
    }
  }
}

function literalQuote(source: string, quote: string) {
  if (source.includes(quote)) return quote;
  // Match the same consecutive words when STT punctuation or accents differ.
  const words = /[\p{L}\p{M}\p{N}]+/gu;
  const expected = [...quote.matchAll(words)].map(([word]) => normal(word));
  if (expected.length < 2) return;
  const tokens = [...source.matchAll(words)];
  const start = tokens.findIndex((_, index) =>
    expected.every((word, offset) => normal(tokens[index + offset]?.[0] ?? '') === word));
  if (start === -1) return;
  const end = tokens[start + expected.length - 1];
  const literal = source.slice(tokens[start].index, end.index + end[0].length);
  return literal.length <= 1000 ? literal : undefined;
}
