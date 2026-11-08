import { day, looksLikeSecret, memoryKey, readDraft, redactMemoryPrompt, selectMemoryContext, type MemoryHit } from './memory.types';

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
