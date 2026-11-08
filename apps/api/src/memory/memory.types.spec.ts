import type { PrismaService } from '../prisma/prisma.service';
import { MemoryService } from './memory.service';
import { day, isChatOnlyMemoryRequest, isExplicitMemorySave, looksLikeSecret, memoryKey, readDraft, redactMemoryPrompt, selectMemoryContext, type MemoryHit } from './memory.types';

describe('personal memory boundaries', () => {
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
    expect(selectMemoryContext([hit], [search])).toEqual([{ hit, reason: 'fixada' }]);
    expect(selectMemoryContext([hit], [search, { result: { memory: 'forget', items: [], outcome: 'forgotten' } }])).toEqual([]);
    expect(JSON.stringify(redactMemoryPrompt([{ role: 'user', content: 'Personal memory data for this reply: Boreal Desk' }])))
      .not.toContain('Boreal Desk');
  });
});
