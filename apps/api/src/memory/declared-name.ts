import { hasChatScope, type Draft } from './memory.types';

const SELF_INTRODUCTION = /^(?:meu nome(?:\s+(completo|preferido))?\s+[ée]|me chamo)\s+(.+)$/iu;
const FULL_NAME = /^(?:e\s+)?(?:(?:o|meu)\s+)?nome completo\s+[ée]\s+(.+)$/iu;
const GREETING = /^prazer(?:\s+em\s+te\s+conhecer)?$/iu;
const NAME_WORD = /^[\p{L}\p{M}]+(?:[-'’][\p{L}\p{M}]+)*$/u;
const OTHER_CLAUSE = /\b(?:sou|moro|trabalho|estou|gosto|uso|quero|fingindo|nome\s+completo)\b/iu;

export function declaredNames(content: string): Array<Draft & { quote: string }> {
  if (hasChatScope(content)) return [];
  const clauses = content.trim().replace(/^luna\s*[:,]\s*/iu, '')
    .split(/[,.;!\r\n]+|\s+e\s+(?=(?:o|meu)\s+nome\s+completo\b)/iu)
    .map(clause => clause.trim()).filter(Boolean);
  const first = SELF_INTRODUCTION.exec(clauses[0] ?? '');
  if (!first) return [];
  const extra = FULL_NAME.exec(clauses[1] ?? '');
  const rest = clauses.slice(extra ? 2 : 1);
  if (rest.length > 1 || (rest.length && !GREETING.test(rest[0]))) return [];
  const relation = first[1]?.toLocaleLowerCase('pt-BR');
  if (extra && relation === 'completo') return [];

  const names = [{ predicate: relation ? 'nome ' + relation : 'nome', value: first[2].trim(), quote: clauses[0] }];
  if (extra) names.push({ predicate: 'nome completo', value: extra[1].trim(), quote: clauses[1] });
  if (names.some(({ value }) => value.length > 120 || OTHER_CLAUSE.test(value) ||
    value.split(/\s+/u).some(word => !NAME_WORD.test(word)))) return [];
  return names.map(name => ({
    ...name, subject: 'Usuário', scope: 'global', kind: 'profile', validFrom: null, operation: 'add',
  }));
}
