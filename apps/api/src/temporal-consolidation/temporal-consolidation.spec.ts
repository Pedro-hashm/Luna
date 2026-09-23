import { isTemporalCandidate } from './candidate-detector';
import { isWithinTemporalWindow } from './temporal-consolidation.service';
import {
  InvalidTemporalOutputError,
  parseExtractedChange,
  parseValidatedChange,
} from './temporal-structured-output';

describe('temporal candidate detector', () => {
  it.each([
    'Agora é Nebula 48.',
    'Substituí X por Y.',
    'Mudamos o nome. Agora é Nebula 48.',
    'lembra do projeto nebula 47 ? agora se chama nebula 49',
    'Eu disse PostgreSQL, mas na verdade usamos SQLite.',
    'We renamed the project to Nebula 48.',
  ])('accepts explicit change signal: %s', (content) => {
    expect(isTemporalCandidate(content)).toBe(true);
  });

  it.each([
    'Hoje trabalhei no Nebula 47.',
    'Hoje falei sobre Nebula 48.',
    'Estou olhando o Nebula 48 agora.',
    'Você sabe como se chama o projeto Nebula 49 agora?',
  ])('skips ordinary mention: %s', (content) => {
    expect(isTemporalCandidate(content)).toBe(false);
  });
});

describe('temporal structured output', () => {
  it('accepts JSON fenced by the model and validates a grounded predecessor', () => {
    expect(parseExtractedChange('```json\n{"type":"SUPERSEDES","subject":"projeto Nebula","oldValue":null,"newValue":"Nebula 48","confidence":0.94,"reason":"O nome mudou."}\n```').type)
      .toBe('SUPERSEDES');
    expect(parseValidatedChange('{"type":"CORRECTS","subject":"banco de dados","oldValue":"PostgreSQL","newValue":"SQLite","confidence":0.98,"reason":"Corrige o banco.","predecessorMessageId":"old-id"}').predecessorMessageId)
      .toBe('old-id');
  });

  it('rejects invalid JSON and unsupported relationships', () => {
    expect(() => parseExtractedChange('not JSON')).toThrow(InvalidTemporalOutputError);
    expect(() => parseValidatedChange('{"type":"SUPERSEDES","subject":"project","oldValue":null,"newValue":"Nebula 48","confidence":0.9,"reason":"change","predecessorMessageId":"old-id"}'))
      .toThrow(InvalidTemporalOutputError);
  });

  it('allows an implied subject in extraction but requires one after historical validation', () => {
    const extraction = {
      type: 'SUPERSEDES', subject: null, oldValue: 'nebula 47',
      newValue: 'nebula 49', confidence: 0.95, reason: 'O projeto foi renomeado.',
    };
    expect(parseExtractedChange(JSON.stringify(extraction))).toMatchObject({
      type: 'SUPERSEDES',
      subject: null,
      oldValue: 'nebula 47',
      newValue: 'nebula 49',
    });
    expect(() => parseExtractedChange(JSON.stringify({ ...extraction, newValue: null })))
      .toThrow(InvalidTemporalOutputError);
    expect(() => parseValidatedChange(JSON.stringify({ ...extraction, predecessorMessageId: 'old-id' })))
      .toThrow(InvalidTemporalOutputError);
    expect(parseValidatedChange(JSON.stringify({ ...extraction, subject: 'nome do projeto', predecessorMessageId: 'old-id' })))
      .toMatchObject({ subject: 'nome do projeto', predecessorMessageId: 'old-id' });
  });
});

describe('temporal schedule', () => {
  const inside = new Date('2026-09-23T08:00:00.000Z'); // 05:00 in São Paulo
  const outside = new Date('2026-09-23T13:00:00.000Z'); // 10:00 in São Paulo

  it('uses the application timezone and excludes the end of the window', () => {
    expect(isWithinTemporalWindow(inside, 'America/Sao_Paulo', '04:30', '08:30')).toBe(true);
    expect(isWithinTemporalWindow(outside, 'America/Sao_Paulo', '04:30', '08:30')).toBe(false);
    expect(isWithinTemporalWindow(new Date('2026-09-23T11:30:00.000Z'), 'America/Sao_Paulo', '04:30', '08:30')).toBe(false);
  });
});
