import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { formatApplicationDate } from '../time/application-time';
import {
  allowsAutomaticMemory, bounded, day, flag, FORGET, hash, isExplicitMemorySave, looksLikeSecret, memoryKey, normal, object, readDraft,
  sourceFingerprint, type Draft, type MemoryHit, type MemoryResult,
} from './memory.types';
import {
  MAX_FIXED_MEMORY_TOKENS, MEMORY_RECALL_WINDOW_DAYS, rankFixedMemory, selectMemoryContext, type FixedMemory,
} from './memory-context';
import { declaredNames, nameRelationMatches } from './declared-name';

type Source = { messageId: string; quote: string; notice?: boolean };
type Controls = { allowModel?: boolean; pinned?: boolean; archived?: boolean };
const latest = { orderBy: { number: 'desc' as const }, take: 1 };
const includeCurrent = { revisions: latest };

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  settings() {
    return this.prisma.memorySettings.findUniqueOrThrow({ where: { id: 1 } });
  }

  async reviewStatus(sourceId: string) {
    const source = await this.prisma.message.findUnique({
      where: { id: sourceId },
      select: {
        memoryJob: { select: { done: true, attempts: true } },
        memorySuggestions: { take: 1, select: { id: true } },
        memoryChanges: { where: { undoneAt: null, revisionId: { not: null } }, take: 1, select: { id: true } },
      },
    });
    if (source?.memoryChanges.length) return 'saved' as const;
    if (source?.memorySuggestions.length) return 'review' as const;
    const job = source?.memoryJob;
    if (!job) return undefined;
    if (job.done) return 'processed' as const;
    return job.attempts < 3 ? 'queued' as const : 'failed' as const;
  }

  async configure(body: unknown) {
    const input = object(body);
    const data = Object.fromEntries(['enabled', 'suggestionsEnabled', 'allowExplicitUse']
      .filter(key => input[key] !== undefined).map(key => [key, flag(input[key], false)]));
    const maxTokens = input.fixedContextMaxTokens;
    if (maxTokens !== undefined && (typeof maxTokens !== 'number' || !Number.isInteger(maxTokens) ||
      maxTokens < 0 || maxTokens > MAX_FIXED_MEMORY_TOKENS)) {
      throw new BadRequestException('O orçamento da memória fixa deve ser um inteiro entre 0 e 4096.');
    }
    return this.prisma.memorySettings.update({
      where: { id: 1 }, data: { ...data, fixedContextMaxTokens: maxTokens as number | undefined },
    });
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
    const date = formatApplicationDate(new Date(), await this.timeZone());
    const fixed = await this.fixed(date, settings);
    const application = await this.prisma.applicationSettings.findUnique({
      where: { id: 1 }, select: { llmCombo: true, llmMaxTokens: true },
    });
    const preview = selectMemoryContext(fixed, [], [], application?.llmCombo ?? '', application?.llmMaxTokens);
    return {
      settings, items: items.map(({ key: _key, ...item }) => item),
      suggestions: suggestions.map(({ fingerprint: _fingerprint, itemKey, ...suggestion }) => {
        const item = byKey.get(itemKey);
        return {
          ...suggestion,
          existing: item ? { id: item.id, version: item.version, value: item.revisions[0]?.value, allowModel: item.allowModel } : null,
        };
      }),
      queue: { pending, failed },
      fixed: {
        tokens: preview.tokens, effectiveLimit: preview.fixedBudget,
        items: fixed.items.map(({ hit, reason, chats }) => ({
          id: hit.id, subject: hit.subject, predicate: hit.predicate, reason, chats,
          included: preview.items.some(item => item.id === hit.id),
        })),
      },
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
      return this.apply(tx, draft, item ? controls : { allowModel: true, ...controls }, null, item?.version ?? null);
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
      const controls = this.controls(input);
      const saved = await this.apply(tx, draft, expected === null ? { allowModel: true, ...controls } : controls, {
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

  async activity(conversationId: string) {
    const [changes, pending] = await Promise.all([
      this.prisma.memoryChange.findMany({
        where: { message: { conversationId } }, orderBy: { createdAt: 'asc' },
        include: { revision: { include: { item: true, sources: true } } },
      }),
      this.prisma.memoryJob.count({ where: { message: { conversationId }, done: false, attempts: { lt: 3 } } }),
    ]);
    return {
      pending: pending > 0,
      changes: changes.map(({ id, messageId, revision, previousRevision, undoneAt }) => ({
        id, messageId,
        status: undoneAt ? 'undone' : revision ? 'saved' : 'removed',
        updated: previousRevision !== null,
        memory: revision ? {
          id: revision.item.id, predicate: revision.item.predicate, value: revision.value,
          quote: revision.sources.find(source => source.messageId === messageId)?.quote,
          allowModel: revision.item.allowModel,
          canUndo: revision.item.version === revision.number && !revision.sources.some(source => source.messageId !== messageId),
        } : null,
      })),
    };
  }

  async undoChange(id: string) {
    return this.atomic(async tx => {
      const change = await tx.memoryChange.findUnique({
        where: { id }, include: { revision: { include: { item: true, sources: true } } },
      });
      if (!change) throw new NotFoundException('Gravação de memória não encontrada.');
      if (change.undoneAt) return { undone: true };
      const revision = change.revision;
      if (!revision || revision.item.version !== revision.number ||
        revision.sources.some(source => source.messageId !== change.messageId)) {
        throw new ConflictException('A memória mudou desde esta gravação. Revise o item antes de alterá-lo.');
      }
      const source = revision.sources.find(row => row.messageId === change.messageId);
      await tx.memorySuppression.createMany({
        data: [revision.value, source?.quote].filter((value): value is string => Boolean(value))
          .map(value => ({ key: sourceFingerprint(change.messageId, value) })),
        skipDuplicates: true,
      });
      await tx.memoryChange.update({ where: { id }, data: { undoneAt: new Date(), revisionId: null } });
      if (change.previousRevision === null) {
        await tx.memoryItem.delete({ where: { id: revision.itemId } });
      } else {
        await tx.memoryRevision.update({
          where: { itemId_number: { itemId: revision.itemId, number: change.previousRevision } },
          data: { status: 'active', validTo: change.previousValidTo },
        });
        await tx.memoryRevision.delete({ where: { id: revision.id } });
        await tx.memoryItem.update({
          where: { id: revision.itemId }, data: { kind: change.previousKind ?? revision.item.kind, version: { increment: 1 } },
        });
      }
      return { undone: true };
    });
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
    if (!settings.enabled || !isExplicitMemorySave(message.content)) throw new BadRequestException('Peça explicitamente para lembrar ou corrigir.');
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
      return this.apply(tx, draft, item ? {} : { allowModel: settings.allowExplicitUse }, { messageId, quote, notice: true }, item?.version ?? null);
    });
    return { memory: 'save', items: [], outcome: saved.allowModel ? 'saved' : 'saved-private' };
  }

  async explicitForget(messageId: string, conversationId: string): Promise<MemoryResult> {
    const message = await this.source(messageId, conversationId);
    const settings = await this.settings();
    if (!settings.enabled || !FORGET.test(message.content)) throw new BadRequestException('Peça explicitamente para esquecer.');
    const words = (value: string) => normal(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const request = ' ' + words(message.content.replace(FORGET, '')) + ' ';
    const mentions = (value: string) => {
      const phrase = words(value);
      return Boolean(phrase) && request.includes(' ' + phrase + ' ');
    };
    const items = await this.prisma.memoryItem.findMany({ select: {
      id: true, version: true, subject: true, predicate: true, scope: true,
      revisions: { ...latest, select: { value: true } },
    } });
    const matches = items.filter(({ subject, predicate, scope, revisions }) => {
      if (scope !== 'global' && !mentions(scope)) return false;
      const value = revisions[0]?.value;
      return (mentions(predicate) && (normal(subject) === 'usuario' || mentions(subject))) ||
        Boolean(value && mentions(value));
    });
    if (matches.length !== 1) throw new BadRequestException('Identifique exatamente a memória a esquecer.');
    const [item] = matches;
    await this.forget(item.id, item.version);
    return { memory: 'forget', items: [], outcome: 'forgotten' };
  }

  async fixed(date: string, settings: Awaited<ReturnType<MemoryService['settings']>>): Promise<FixedMemory> {
    const maxTokens = settings.enabled ? settings.fixedContextMaxTokens : 0;
    if (!maxTokens) return { items: [], maxTokens, disabled: !settings.enabled };
    const [items, activity] = await Promise.all([
      this.prisma.memoryItem.findMany({
        where: { scope: 'global', archived: false, allowModel: true, OR: [{ pinned: true }, { kind: { in: ['profile', 'preference'] } }] },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        include: { revisions: this.revisionsAt(date) },
      }),
      this.prisma.$queryRaw<Array<{ itemId: string; revision: number; chats: number; requests: number }>>`
        SELECT "itemId", "revision", count(*)::int AS chats, count(DISTINCT "requestHash")::int AS requests
        FROM "memory_recalls" WHERE "usedAt" >= now() - ${MEMORY_RECALL_WINDOW_DAYS} * interval '1 day'
        GROUP BY "itemId", "revision"
      `,
    ]);
    const byRevision = new Map(activity.map(row => [row.itemId + '/' + row.revision, row]));
    return { maxTokens, items: rankFixedMemory(items.flatMap(item => {
      const revision = item.revisions[0];
      if (!revision) return [];
      const stats = byRevision.get(item.id + '/' + revision.number);
      return [{
        hit: this.hit(item, revision), pinned: item.pinned, kind: item.kind,
        chats: stats?.chats ?? 0, requests: stats?.requests ?? 0,
      }];
    })) };
  }

  async search(query: string, date: string, scope: string): Promise<MemoryResult> {
    const name = /^(nome|nome completo|nome preferido)$/u.test(normal(query)) ? normal(query) : undefined;
    const words = [...new Set(normal(query).split(/[^\p{L}\p{N}]+/u)
      .filter(word => word.length > 2 && !/^(qual|onde|como|atual|usuario|sobre|memoria|voce|meu|minha|moro|estou|falei|que)$/u.test(word)))].slice(0, 10);
    if (/\b(cidade|residencia|moro|morava|moradia|morar)\b/u.test(normal(query))) words.push('residencia', 'cidade');
    return { memory: 'search', items: words.length ? await this.hits(date, scope, words, name) : [] };
  }

  async persistAnswer(
    data: Prisma.MessageUncheckedCreateInput, sourceId: string, request: string,
    recalls: Array<Pick<MemoryHit, 'id' | 'revision'>> = [],
  ) {
    const eligible = request.trim().length >= 12 && allowsAutomaticMemory(request);
    const names = eligible ? declaredNames(request) : [];
    const message = await this.prisma.$transaction(async (tx) => {
      const message = await tx.message.create({ data });
      const settings = await tx.memorySettings.findUnique({ where: { id: 1 } });
      if (settings?.enabled && settings.suggestionsEnabled && eligible) {
        await tx.memoryJob.upsert({
          where: { messageId: sourceId }, update: {},
          create: { messageId: sourceId, availableAt: new Date(Date.now() + 30_000) },
        });
      }
      if (settings?.enabled && recalls.length) {
        const pairs = Prisma.join(recalls.map(({ id, revision }) => Prisma.sql`(${id}::uuid, ${revision}::int)`));
        await tx.$executeRaw`
          INSERT INTO "memory_recalls" ("itemId", "revision", "conversationId", "requestHash")
          SELECT r."itemId", r."number", ${data.conversationId}::uuid, ${hash(normal(request))}
          FROM "memory_revisions" r JOIN "memory_items" i ON i."id" = r."itemId"
          WHERE (r."itemId", r."number") IN (${pairs})
            AND r."status" = 'active' AND i."allowModel" AND NOT i."archived" AND i."scope" = 'global'
          ORDER BY r."itemId", r."number"
          FOR KEY SHARE OF r
          ON CONFLICT ("itemId", "revision", "conversationId") DO UPDATE SET "usedAt" = now()
        `;
      }
      return message;
    });
    if (names.length) {
      try {
        await this.atomic(async tx => {
          const settings = await tx.memorySettings.findUnique({ where: { id: 1 } });
          if (!settings?.enabled || !settings.suggestionsEnabled) return;
          const job = await tx.memoryJob.findFirst({
            where: { messageId: sourceId, done: false, leaseToken: null },
            include: { message: { select: { id: true, content: true, createdAt: true } } },
          });
          if (!job) return;
          for (const { quote, ...draft } of names) {
            await this.saveAutomatic(tx, draft, job.message, quote);
          }
          await tx.memoryJob.update({ where: { messageId: sourceId }, data: { done: true } });
        });
      } catch {
        this.logger.warn('Direct memory write deferred to the analysis queue.');
      }
    }
    return message;
  }

  async saveAutomatic(
    tx: Prisma.TransactionClient, draft: Draft, source: { id: string; content: string; createdAt: Date }, quote: string,
  ) {
    const key = memoryKey(draft);
    if (!allowsAutomaticMemory(source.content) || !source.content.includes(quote) ||
      !normal(quote).includes(normal(draft.value)) || looksLikeSecret(quote)) return false;
    if (draft.scope !== 'global' && !normal(quote).includes(normal(draft.scope))) return false;
    if (draft.validFrom && draft.validFrom > formatApplicationDate(source.createdAt, await this.timeZone(tx))) return false;
    if (await tx.memorySuppression.findFirst({ where: { key: { in: [
      key, sourceFingerprint(source.id, draft.value), sourceFingerprint(source.id, quote),
    ] } } })) return false;
    if (await tx.memoryChange.findUnique({ where: { messageId_itemKey: { messageId: source.id, itemKey: key } } })) return false;

    const item = await tx.memoryItem.findUnique({
      where: { key }, include: { revisions: { ...latest, include: { sources: { include: { message: { select: { createdAt: true } } } } } } },
    });
    if (item?.archived) return false;
    const current = item?.revisions[0];
    const evidence = { messageId: source.id, quote, notice: true };
    if (current) {
      if (normal(current.value) === normal(draft.value) && (draft.operation !== 'correct' || current.validFrom === draft.validFrom)) {
        await this.addSource(tx, current.id, evidence);
        return false;
      }
      const latestSource = current.sources.reduce(
        (last, row) => Math.max(last, row.message.createdAt.getTime()), 0,
      ) || current.recordedAt.getTime();
      const wording = normal(source.content);
      const explicitUpdate = draft.operation === 'change'
        ? /\b(?:mudei|passei a|agora|antes|mudou)\b/u.test(wording)
        : draft.operation === 'correct' && /\b(?:corrigindo|correcao|estava errado|na verdade|nunca)\b/u.test(wording);
      if (!explicitUpdate || source.createdAt.getTime() < latestSource ||
        (draft.operation === 'change' && draft.validFrom && current.validFrom && draft.validFrom <= current.validFrom)) return false;
    } else if (draft.operation !== 'add') {
      return false;
    }
    await this.apply(tx, { ...draft, kind: (item?.kind ?? draft.kind) as Draft['kind'] },
      item ? {} : { allowModel: true }, evidence, item?.version ?? null);
    await tx.memorySuggestion.deleteMany({ where: { itemKey: key, messageId: source.id } });
    return true;
  }

  private async hits(date: string, scope: string, words: string[], name?: string): Promise<MemoryHit[]> {
    if (!(await this.settings()).enabled) return [];
    const items = await this.prisma.memoryItem.findMany({
      where: { scope: { equals: scope, mode: 'insensitive' }, archived: false, allowModel: true },
      orderBy: { updatedAt: 'desc' }, take: 1000,
      include: { revisions: this.revisionsAt(date) },
    });
    const timeZone = await this.timeZone();
    return items.flatMap(item => {
      if (name && (normal(item.subject) !== 'usuario' || !nameRelationMatches(name, item.predicate))) return [];
      const revision = item.revisions[0];
      if (!revision || (!revision.validFrom && formatApplicationDate(revision.recordedAt, timeZone) > date)) return [];
      const identity = normal(item.subject + ' ' + item.predicate);
      const value = normal(revision.value);
      const score = words.reduce((total, word) => total + (identity.includes(word) ? 3 : value.includes(word) ? 1 : 0), 0);
      return score ? [{ score, hit: this.hit(item, revision) }] : [];
    }).sort((a, b) => b.score - a.score).slice(0, 5).map(({ hit }) => hit);
  }

  private hit(
    item: Pick<MemoryHit, 'id' | 'subject' | 'predicate' | 'scope'>,
    revision: { number: number; value: string; validFrom: string | null; validTo: string | null },
  ): MemoryHit {
    return {
      id: item.id, revision: revision.number, subject: item.subject, predicate: item.predicate,
      scope: item.scope, value: revision.value, validFrom: revision.validFrom, validTo: revision.validTo,
    };
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
    if (source?.notice && newRevision &&
      await tx.memoryChange.findUnique({ where: { messageId_itemKey: { messageId: source.messageId, itemKey: key } } })) {
      throw new ConflictException('Esta mensagem já foi usada para alterar esta memória.');
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
    if (source?.notice && newRevision) {
      await tx.memoryChange.createMany({
        data: [{
          messageId: source.messageId, itemKey: key, revisionId: revision.id, previousRevision: current?.number,
          previousValidTo: current?.validTo, previousKind: item?.kind,
        }],
        skipDuplicates: true,
      });
    }
    return saved;
  }

  private async addSource(tx: Prisma.TransactionClient, revisionId: string, source: Source) {
    const { messageId, quote } = source;
    await tx.memorySource.upsert({
      where: { revisionId_messageId: { revisionId, messageId } },
      update: {}, create: { revisionId, messageId, quote },
    });
  }
}
