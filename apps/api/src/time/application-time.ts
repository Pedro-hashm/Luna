type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/**
 * Renders an instant as a valid ISO 8601 timestamp in the configured
 * application timezone. Keeping the offset is essential: a local calendar
 * date such as "today" must not be reinterpreted as UTC by an LLM or client.
 */
export function formatApplicationDateTime(
  date: Date,
  timeZone: string,
): string {
  const parts = getDateTimeParts(date, timeZone);
  const offsetMinutes = Math.round(
    getTimeZoneOffsetMilliseconds(date, timeZone) / 60_000,
  );
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffsetMinutes = Math.abs(offsetMinutes);
  const offsetHours = Math.floor(absoluteOffsetMinutes / 60);
  const offsetRemainderMinutes = absoluteOffsetMinutes % 60;

  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}.${padMilliseconds(date.getMilliseconds())}${sign}${pad(offsetHours)}:${pad(offsetRemainderMinutes)}`;
}

export function formatApplicationDate(date: Date, timeZone: string): string {
  const parts = getDateTimeParts(date, timeZone);

  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function getDateTimeParts(date: Date, timeZone: string): DateTimeParts {
  const values = new Map(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: values.get('year') ?? 0,
    month: values.get('month') ?? 1,
    day: values.get('day') ?? 1,
    hour: values.get('hour') ?? 0,
    minute: values.get('minute') ?? 0,
    second: values.get('second') ?? 0,
  };
}

function getTimeZoneOffsetMilliseconds(date: Date, timeZone: string): number {
  const dateWithoutMilliseconds = new Date(
    Math.floor(date.getTime() / 1_000) * 1_000,
  );
  const parts = getDateTimeParts(dateWithoutMilliseconds, timeZone);
  const renderedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return renderedAsUtc - dateWithoutMilliseconds.getTime();
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function padMilliseconds(value: number): string {
  return String(value).padStart(3, '0');
}
