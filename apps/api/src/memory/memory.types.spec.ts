import type { PrismaService } from '../prisma/prisma.service';
import { MemoryService } from './memory.service';
import { rankFixedMemory, selectMemoryContext } from './memory-context';
import { declaredNames, nameRelationMatches, requestedName } from './declared-name';
import { allowsAutomaticMemory, day, isChatOnlyMemoryRequest, isExplicitMemorySave, looksLikeSecret, memoryKey, readDraft, redactMemoryPrompt, type MemoryHit } from './memory.types';

describe('personal memory boundaries', () => {
  it('extracts literal given and full names as separate review candidates', () => {
    const input = 'meu nome é caio, o nome completo é caio nunes da costa, prazer';
    const names = declaredNames(input);
    expect(names.map(({ predicate, value, quote }) => ({ predicate, value, quote }))).toEqual([
      { predicate: 'nome', value: 'caio', quote: 'meu nome é caio' },
      { predicate: 'nome completo', value: 'caio nunes da costa', quote: 'o nome completo é caio nunes da costa' },
    ]);
    expect(declaredNames('Luna, meu nome preferido é Ana e o nome completo é Ana d’Ávila.'))
      .toHaveLength(2);
    for (const text of ['Meu nome é Caio?', 'Finja que meu nome é Caio.', 'Meu nome é Caio neste chat.',
      'Meu nome é Caio, estou contando uma história.', 'Meu nome é Caio e moro em Recife.']) {
      expect(declaredNames(text)).toEqual([]);
    }
  });

  it('separates direct requests for a name from other tasks and name fields', () => {
    expect(requestedName('Qual é meu nome completo? Responda só o nome.')).toBe('nome completo');
    expect(requestedName('Como eu me chamo?')).toBe('nome');
    expect(requestedName('Qual é meu nome? Pesquise também as notícias de hoje.')).toBeUndefined();
    expect(nameRelationMatches('nome completo', 'nome')).toBe(false);
    expect(nameRelationMatches('nome', 'nome do usuário')).toBe(true);
    expect(nameRelationMatches('nome', 'nome completo')).toBe(false);
  });

  it('normalizes a fact key without collapsing distinct scopes', () => {
    expect(memoryKey({ subject: 'Usuário', predicate: ' Residência ', scope: 'Global' }))
      .toBe(memoryKey({ subject: 'usuario', predicate: 'residencia', scope: 'global' }));
    expect(memoryKey({ subject: 'Usuário', predicate: 'editor', scope: 'Projeto A' }))
      .not.toBe(memoryKey({ subject: 'Usuário', predicate: 'editor', scope: 'Projeto B' }));
  });

  it('rejects invalid dates and credential-like content', () => {
    expect(() => day('2026-02-30')).toThrow();
    expect(looksLikeSecret('Minha senha é exemplo-sintético')).toBe(true);
    expect(() => readDraft({ subject: 'Usuário', predicate: 'chave', kind: 'profile', value: 'sk-fakefixtureabcdefghijklmnop' })).toThrow();
  });

  it('keeps instructions scoped to the current chat out of durable memory', () => {
    const message = 'Luna, guarde só neste contexto de teste: a nave se chama Aurora Sete.';
    expect(isChatOnlyMemoryRequest(message)).toBe(true);
    expect(isExplicitMemorySave(message)).toBe(false);
    expect(isExplicitMemorySave('Lembre que meu editor padrão é Boreal Desk.')).toBe(true);
  });

  it('allows lasting gaming preferences without turning roleplay into profile facts', () => {
    expect(allowsAutomaticMemory('Um dos meus jogos favoritos é Subnautica.')).toBe(true);
    expect(allowsAutomaticMemory('No meu jogo fictício eu interpreto uma personagem que dirige um Porsche.')).toBe(false);
    expect(allowsAutomaticMemory('Hoje eu quero testar um editor por uma hora.')).toBe(false);
  });

  it('forgets a uniquely named memory from the original request and refuses ambiguous targets', async () => {
    const item = {
      id: 'editor', version: 2, subject: 'Usuário', predicate: 'editor padrão', scope: 'global',
      revisions: [{ value: 'Boreal Desk' }],
    };
    const findMany = jest.fn().mockResolvedValue([item, { ...item, id: 'scoped', scope: 'Projeto X' }]);
    const service = new MemoryService({
      message: { findFirst: jest.fn().mockResolvedValue({ content: 'Luna, esqueça meu editor padrão.' }) },
      memorySettings: { findUniqueOrThrow: jest.fn().mockResolvedValue({ enabled: true }) },
      memoryItem: { findMany },
    } as unknown as PrismaService);
    const forget = jest.spyOn(service, 'forget').mockResolvedValue({ forgotten: true });
    await expect(service.explicitForget('user-message', 'chat')).resolves.toMatchObject({ outcome: 'forgotten' });
    expect(forget).toHaveBeenCalledWith('editor', 2);

    findMany.mockResolvedValue([item, { ...item, id: 'other', predicate: 'editor' }]);
    await expect(service.explicitForget('user-message', 'chat')).rejects.toThrow('Identifique exatamente a memória a esquecer.');
    expect(forget).toHaveBeenCalledTimes(1);
  });

  it('removes recalled content from the prompt inspector and after a forget operation', () => {
    const hit: MemoryHit = {
      id: 'test', revision: 1, subject: 'Usuário', predicate: 'editor',
      scope: 'global', value: 'Boreal Desk', validFrom: null, validTo: null,
    };
    const search = { result: { memory: 'search', items: [hit] } };
    const fixed = { items: [{ hit, reason: 'fixada' as const, chats: 0 }] };
    expect(selectMemoryContext(fixed, [search], [], 'paid-general')).toMatchObject({
      items: [{ id: 'test', revision: 1, reason: 'fixada' }], recalls: [{ id: 'test', revision: 1 }],
    });
    expect(selectMemoryContext(fixed, [search, { result: { memory: 'forget', items: [], outcome: 'forgotten' } }], [], 'paid-general'))
      .toMatchObject({ items: [], recalls: [], tokens: 0 });
    expect(JSON.stringify(redactMemoryPrompt([{ role: 'user', content: 'Personal memory data for this reply: Boreal Desk' }])))
      .not.toContain('Boreal Desk');
  });

  it('prioritizes explicit pins, stable profile facts and independently recalled preferences', () => {
    const hit = (id: string, predicate: string): MemoryHit => ({
      id, predicate, subject: 'Usuário', scope: 'global', value: 'Exemplo', revision: 1, validFrom: null, validTo: null,
    });
    const ranked = rankFixedMemory([
      { hit: hit('repeat', 'tema'), kind: 'preference', pinned: false, chats: 12, requests: 1 },
      { hit: hit('frequent', 'editor padrão'), kind: 'preference', pinned: false, chats: 3, requests: 2 },
      { hit: hit('project', 'versão do PostgreSQL'), kind: 'project', pinned: false, chats: 12, requests: 8 },
      { hit: hit('name', 'nome preferido'), kind: 'profile', pinned: false, chats: 0, requests: 0 },
      { hit: hit('pinned', 'hobby'), kind: 'profile', pinned: true, chats: 0, requests: 0 },
    ]);
    expect(ranked.map(({ hit, reason }) => [hit.id, reason])).toEqual([
      ['pinned', 'fixada'], ['name', 'perfil'], ['frequent', 'recorrente'],
    ]);
  });

  it('packs whole records within the serialized budget after other prompt content', () => {
    const hit: MemoryHit = {
      id: 'profile', revision: 1, subject: 'Usuário', predicate: 'nome',
      scope: 'global', value: 'Aurora', validFrom: null, validTo: null,
    };
    const fixed = { maxTokens: 100, items: [
      { hit: { ...hit, id: 'large', value: 'a'.repeat(400) }, reason: 'fixada' as const, chats: 0 },
      { hit, reason: 'perfil' as const, chats: 0 },
    ] };
    expect(selectMemoryContext(fixed, [], [], 'paid-general')).toMatchObject({
      items: [{ id: 'profile', revision: 1, reason: 'perfil' }], recalls: [],
    });
    const search = { result: { memory: 'search', items: [hit] } };
    expect(selectMemoryContext({ ...fixed, maxTokens: 0 }, [search], [], 'local-general'))
      .toMatchObject({ items: [{ id: 'profile', reason: 'busca' }], fixedBudget: 0 });
    expect(selectMemoryContext(fixed, [search], [{ role: 'system', content: 'x'.repeat(26_620) }], 'local-general'))
      .toMatchObject({ items: [], totalBudget: 0, tokens: 0, recalls: [] });
  });
});
