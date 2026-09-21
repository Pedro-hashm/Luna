const RUNTIME_OWNED_ARGUMENTS = new Set([
  'conversationid',
  'currentconversationid',
  'currentmessageid',
  'messageid',
  'chunkid',
  'requestid',
  'toolcallid',
  'sessionid',
  'userid',
  'currentdatetime',
  'timestamp',
  'createdat',
  'updatedat',
]);

/**
 * Runtime-owned values are never valid LLM-produced tool arguments. The
 * normalized suffix rule deliberately catches future identifier names too.
 */
export function isRuntimeOwnedToolArgument(key: string): boolean {
  const normalized = key.replace(/[_-]/gu, '').toLowerCase();

  return (
    RUNTIME_OWNED_ARGUMENTS.has(normalized) ||
    normalized.endsWith('id') ||
    normalized.endsWith('timestamp')
  );
}
