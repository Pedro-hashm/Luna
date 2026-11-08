import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { formatApplicationDate } from '../time/application-time';
import {
  bounded, day, flag, FORGET, looksLikeSecret, memoryKey, normal, object, readDraft, REMEMBER,
  sourceFingerprint, type Draft, type MemoryHit, type MemoryResult,
} from './memory.types';

type Source = { messageId: string; quote: string };
type Controls = { allowModel?: boolean; pinned?: boolean; archived?: boolean };
const latest = { orderBy: { number: 'desc' as const }, take: 1 };
const includeCurrent = { revisions: latest };

@Injectable()
export class MemoryService {
  constructor(private readonly prisma: PrismaService) {}

  settings() {
    return this.prisma.memorySettings.findUniqueOrThrow({ where: { id: 1 } });
  }

  async configure(body: unknown) {
    const input = object(body);
    const data = Object.fromEntries(['enabled', 'suggestionsEnabled', 'allowExplicitUse']
      .filter(key => input[key] !== undefined).map(key => [key, flag(input[key], false)]));
    return this.prisma.memorySettings.update({ where: { id: 1 }, data });
  }

  async list() {
    const [settings, items, suggestions, pending, failed] = await Promise.all([
      this.settings(),
      this.prisma.memoryItem.findMany({ orderBy: { updatedAt: 'desc' }, take: 300, include: includeCurrent }),
      this.prisma.memorySuggestion.findMany({
        orderBy: { createdAt: 'desc' }, take: 100,
        include: { message: { select: { conversationId: true, createdAt: true } } },
      }),
      this.prisma.memoryJob.count({ where: { done: false, attempts: { lt: 3 } } }),
      this.prisma.memoryJob.count({ where: { done: false, attempts: { gte: 3 } } }),
    ]);
    const byKey = new Map(items.map(item => [item.key, item]));
    return {
      settings, items: items.map(({ key: _key, ...item }) => item),
      suggestions: suggestions.map(({ fingerprint: _fingerprint, itemKey, ...suggestion }) => {
        const item = byKey.get(itemKey);
        return {
          ...suggestion,
          existing: item ? { id: item.id, version: item.version, value: item.revisions[0]?.value } : null,
        };
      }),
      queue: { pending, failed },
    };
  }

  async map(input: unknown, asOf: unknown) {
    const subject = bounded(input, 'Assunto', 80);
    const date = day(asOf);
    const items = await this.prisma.memoryItem.findMany({
      where: { subject: { equals: subject, mode: 'insensitive' }, archived: false },
      include: { revisions: date ? this.revisionsAt(date) : latest },
      orderBy: { updatedAt: 'desc' }, take: 100,
    });
    const timeZone = date ? await this.timeZone() : 'America/Sao_Paulo';
    return items.filter(item => {
      const revision = item.revisions[0];
      return revision && (!date || revision.validFrom || formatApplicationDate(revision.recordedAt, timeZone) <= date);
    }).map(({ key: _key, ...item }) => item);
  }

  async get(id: string) {
    const item = await this.prisma.memoryItem.findUnique({
      where: { id },
      include: { revisions: {
        orderBy: { number: 'desc' },
        include: { sources: { include: { message: { select: { conversationId: true, createdAt: true } } } } },
      } },
    });
    if (!item) throw new NotFoundException('Memória não encontrada.');
    const { key: _key, ...result } = item;
    return result;
  }

  async save(body: unknown, id?: string) {
    const input = object(body);
    const draft = readDraft(input);
    const controls = this.controls(input);
    return this.atomic(async (tx) => {
      const item = id ? await tx.memoryItem.findUnique({ where: { id } }) : null;
      if (id && !item) throw new NotFoundException('Memória não encontrada.');
      if (item && (item.key !== memoryKey(draft) || item.version !== input.version)) {
        throw new ConflictException('A memória mudou. Reabra o item antes de editar.');
      }
      if (!id && draft.operation !== 'add') throw new BadRequestException('Abra a memória existente antes de alterá-la.');
      return this.apply(tx, draft, controls, null, item?.version ?? null);
    });
  }

  async approve(id: string, body: unknown) {
    const input = object(body);
    return this.atomic(async (tx) => {
      const suggestion = await tx.memorySuggestion.findUnique({
        where: { id }, include: { message: { select: { content: true, role: true } } },
      });
      if (!suggestion) throw new NotFoundException('Sugestão não encontrada.');
      if (suggestion.message.role !== 'user' || !suggestion.message.content.includes(suggestion.quote)) {
        throw new ConflictException('A fonte da sugestão mudou.');
      }
      const draft = readDraft(input.draft ?? suggestion.draft);
      const key = memoryKey(draft);
      if (await tx.memorySuppression.findFirst({ where: { key: { in: [key, sourceFingerprint(suggestion.messageId, draft.value)] } } })) {
        throw new ConflictException('Essa memória foi esquecida. Crie uma nova memória explicitamente.');
      }
      const expected = key === suggestion.itemKey
        ? input.version ?? suggestion.expectedVersion
        : null;
      if (expected !== null && (typeof expected !== 'number' || !Number.isSafeInteger(expected))) {
        throw new BadRequestException('Versão inválida.');
      }
      const saved = await this.apply(tx, draft, this.controls(input), {
        messageId: suggestion.messageId, quote: suggestion.quote,
      }, expected);
      await tx.memorySuggestion.delete({ where: { id } });
      return saved;
    });
  }

  async dismiss(id: string) {
    await this.prisma.memorySuggestion.deleteMany({ where: { id } });
    return { dismissed: true };
  }

  async forget(id: string, version: unknown) {
    return this.atomic(async (tx) => {
      const item = await tx.memoryItem.findUnique({ where: { id } });
      if (!item) throw new NotFoundException('Memória não encontrada.');
      if (item.version !== version) throw new ConflictException('A memória mudou. Reabra o item antes de esquecer.');
      const revisions = await tx.memoryRevision.findMany({ where: { itemId: item.id }, include: { sources: true } });
      const keys = [item.key, ...revisions.flatMap(revision =>
        revision.sources.flatMap(source => [
          sourceFingerprint(source.messageId, revision.value),
          sourceFingerprint(source.messageId, source.quote),
        ]),
      )];
      await tx.memorySuppression.createMany({ data: keys.map(key => ({ key })), skipDuplicates: true });
      await tx.memorySuggestion.deleteMany({ where: { itemKey: item.key } });
      await tx.memoryItem.delete({ where: { id } });
      return { forgotten: true };
    });
  }

  async explicitSave(body: Record<string, unknown>, messageId: string, conversationId: string): Promise<MemoryResult> {
    const message = await this.source(messageId, conversationId);
    const settings = await this.settings();
    if (!settings.enabled || !REMEMBER.test(message.content)) throw new BadRequestException('Peça explicitamente para lembrar ou corrigir.');
    const draft = readDraft(body);
    const quote = bounded(body.quote, 'Trecho de origem', 1000);
    if (!message.content.includes(quote) || !normal(quote).includes(normal(draft.value)) || looksLikeSecret(quote)) {
      throw new BadRequestException('Use o valor literal presente no pedido do usuário.');
    }
    if (draft.scope !== 'global' && !normal(quote).includes(normal(draft.scope))) {
      throw new BadRequestException('O escopo precisa aparecer no trecho.');
    }
    if (draft.operation !== 'add' && !/\b(?:corrij[ae]|errad[oa]|nunca|atualiz[ae]|agora|mudei|mudou|antes|passei)\b/iu.test(quote)) {
      throw new BadRequestException('A mudança ou correção precisa estar explícita na fonte.');
    }
    const saved = await this.atomic(async (tx) => {
      const item = await tx.memoryItem.findUnique({ where: { key: memoryKey(draft) } });
      return this.apply(tx, draft, item ? {} : { allowModel: settings.allowExplicitUse }, { messageId, quote }, item?.version ?? null);
    });
    return { memory: 'save', items: [], outcome: saved.allowModel ? 'saved' : 'saved-private' };
  }

  async explicitForget(body: Record<string, unknown>, messageId: string, conversationId: string): Promise<MemoryResult> {
    const message = await this.source(messageId, conversationId);
    const settings = await this.settings();
    if (!settings.enabled || !FORGET.test(message.content)) throw new BadRequestException('Peça explicitamente para esquecer.');
    const subject = bounded(body.subject, 'Assunto', 80);
    const predicate = bounded(body.predicate, 'Relação', 80);
    const scope = body.scope ? bounded(body.scope, 'Escopo', 80) : 'global';
    const item = await this.prisma.memoryItem.findUnique({
      where: { key: memoryKey({ subject, predicate, scope }) }, include: includeCurrent,
    });
    const normalized = normal(message.content);
    const target = item?.revisions[0]?.value;
    const explicitTarget = normalized.includes(normal(predicate)) &&
      (normal(subject) === 'usuario' || normalized.includes(normal(subject)));
    if (!item || !(explicitTarget || (target && normalized.includes(normal(target)))) ||
      (scope !== 'global' && !normalized.includes(normal(scope)))) {
      throw new BadRequestException('Identifique exatamente a memória a esquecer.');
    }
    await this.forget(item.id, item.version);
    return { memory: 'forget', items: [], outcome: 'forgotten' };
  }

  async pinned(date: string): Promise<MemoryHit[]> {
    return this.hits(date, 'global', [], true);
  }

  async search(query: string, date: string, scope: string): Promise<MemoryResult> {
    const words = [...new Set(normal(query).split(/[^\p{L}\p{N}]+/u)
      .filter(word => word.length > 2 && !/^(qual|onde|como|atual|usuario|sobre|memoria|voce|meu|minha|moro|estou|falei|que)$/u.test(word)))].slice(0, 10);
    if (/\b(cidade|residencia|moro|morava|moradia|morar)\b/u.test(normal(query))) words.push('residencia', 'cidade');
    return { memory: 'search', items: words.length ? await this.hits(date, scope, words, false) : [] };
  }

  async persistAnswer(data: Prisma.MessageUncheckedCreateInput, sourceId: string) {
    return this.prisma.$transaction(async (tx) => {
      const message = await tx.message.create({ data });
      const settings = await tx.memorySettings.findUnique({ where: { id: 1 } });
      if (settings?.enabled && settings.suggestionsEnabled) {
        await tx.memoryJob.upsert({
          where: { messageId: sourceId }, update: {},
          create: { messageId: sourceId, availableAt: new Date(Date.now() + 30_000) },
        });
      }
      return message;
    });
  }

  private async hits(date: string, scope: string, words: string[], pinned: boolean): Promise<MemoryHit[]> {
    if (!(await this.settings()).enabled) return [];
    const items = await this.prisma.memoryItem.findMany({
      where: { scope: { equals: scope, mode: 'insensitive' }, archived: false, allowModel: true, ...(pinned && { pinned: true }) },
      orderBy: { updatedAt: 'desc' }, take: 1000,
      include: { revisions: this.revisionsAt(date) },
    });
    const timeZone = await this.timeZone();
    return items.flatMap(item => {
      const revision = item.revisions[0];
      if (!revision || (!revision.validFrom && formatApplicationDate(revision.recordedAt, timeZone) > date)) return [];
      const identity = normal(item.subject + ' ' + item.predicate);
      const value = normal(revision.value);
      const score = words.reduce((total, word) => total + (identity.includes(word) ? 3 : value.includes(word) ? 1 : 0), 0);
      if (!pinned && !score) return [];
      return [{ score, hit: {
        id: item.id, revision: revision.number, subject: item.subject, predicate: item.predicate,
        scope: item.scope, value: revision.value, validFrom: revision.validFrom, validTo: revision.validTo,
      } }];
    }).sort((a, b) => b.score - a.score).slice(0, pinned ? 3 : 5).map(({ hit }) => hit);
  }

  private revisionsAt(date: string) {
    return {
      where: {
        status: { not: 'retracted' },
        AND: [
          { OR: [{ validFrom: { lte: date } }, { validFrom: null }] },
          { OR: [{ validTo: { gt: date } }, { validTo: null, status: 'active' }] },
        ],
      },
      orderBy: { number: 'desc' as const }, take: 1,
    };
  }

  private async timeZone(tx: Prisma.TransactionClient = this.prisma) {
    const settings = await tx.applicationSettings.findUnique({ where: { id: 1 }, select: { appTimezone: true } });
    return settings?.appTimezone ?? 'America/Sao_Paulo';
  }

  private controls(input: Record<string, unknown>): Controls {
    const controls: Controls = {};
    for (const key of ['allowModel', 'pinned', 'archived'] as const) {
      if (input[key] !== undefined) controls[key] = flag(input[key], false);
    }
    return controls;
  }

  private async source(id: string, conversationId: string) {
    const message = await this.prisma.message.findFirst({ where: { id, conversationId, role: 'user' } });
    if (!message) throw new BadRequestException('A mensagem de origem não está disponível.');
    return message;
  }

  private async atomic<T>(task: (tx: Prisma.TransactionClient) => Promise<T>) {
    try {
      return await this.prisma.$transaction(task, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034', 'P2025'].includes(error.code)) {
        throw new ConflictException('A memória mudou em outra operação. Recarregue e tente novamente.');
      }
      throw error;
    }
  }

  private async apply(tx: Prisma.TransactionClient, draft: Draft, controls: Controls, source: Source | null, expected: number | null) {
    const key = memoryKey(draft);
    const item = await tx.memoryItem.findUnique({ where: { key }, include: includeCurrent });
    if ((item?.version ?? null) !== expected) throw new ConflictException('A memória mudou. Revise a versão atual.');
    const current = item?.revisions[0];
    const today = formatApplicationDate(new Date(), await this.timeZone(tx));
    if (draft.validFrom && draft.validFrom > today) throw new BadRequestException('Use uma data já ocorrida.');
    const sameValue = current && normal(current.value) === normal(draft.value);
    const sameDates = current && current.validFrom === draft.validFrom;
    const newRevision = !current || !sameValue || (draft.operation === 'correct' && !sameDates);
    if (current && newRevision && draft.operation === 'add') {
      throw new ConflictException('Já existe um valor. Escolha mudança ao longo do tempo ou correção.');
    }
    if (current && newRevision && draft.operation === 'change' &&
      draft.validFrom && current.validFrom && draft.validFrom <= current.validFrom) {
      throw new ConflictException('A mudança precisa ocorrer depois do início anterior.');
    }
    if (current && !newRevision && !Object.keys(controls).length) {
      if (source) await this.addSource(tx, current.id, source);
      return item;
    }
    const saved = item
      ? await tx.memoryItem.update({ where: { id: item.id }, data: { ...controls, kind: draft.kind, version: { increment: 1 } } })
      : await tx.memoryItem.create({ data: { key, subject: draft.subject, predicate: draft.predicate, scope: normal(draft.scope) === 'global' ? 'global' : draft.scope, kind: draft.kind, ...controls } });
    if (current && newRevision) await tx.memoryRevision.update({
      where: { id: current.id },
      data: { status: draft.operation === 'correct' ? 'retracted' : 'historical', validTo: draft.validFrom },
    });
    const revision = newRevision ? await tx.memoryRevision.create({
      data: { itemId: saved.id, number: saved.version, value: draft.value, validFrom: draft.validFrom, status: 'active' },
    }) : current!;
    if (source) await this.addSource(tx, revision.id, source);
    return saved;
  }

  private async addSource(tx: Prisma.TransactionClient, revisionId: string, source: Source) {
    await tx.memorySource.upsert({
      where: { revisionId_messageId: { revisionId, messageId: source.messageId } },
      update: {}, create: { revisionId, ...source },
    });
  }
}
