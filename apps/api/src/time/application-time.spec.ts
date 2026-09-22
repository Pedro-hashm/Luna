import {
  formatApplicationDate,
  formatApplicationDateTime,
} from './application-time';

describe('application time formatting', () => {
  it('keeps the configured local calendar day and offset', () => {
    const instant = new Date('2026-09-22T00:22:06.989Z');

    expect(formatApplicationDateTime(instant, 'America/Sao_Paulo')).toBe(
      '2026-09-21T21:22:06.989-03:00',
    );
    expect(formatApplicationDate(instant, 'America/Sao_Paulo')).toBe(
      '2026-09-21',
    );
  });
});
