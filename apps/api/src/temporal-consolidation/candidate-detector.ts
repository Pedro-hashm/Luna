/** Cheap, deliberately conservative gate. The LLM still has to prove a change. */
const CHANGE_SIGNALS = [
  /(?<![\p{L}\p{N}])(?:agora\s+(?:é|são|se\s+chama|usa(?:mos)?|utiliza(?:mos)?)|passou\s+a\s+ser|antes\s+era|não\s+é\s+mais|não\s+usamos\s+mais)(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])(?:mudamos|mudou|alteramos|alterou|renomeamos|renomeou|trocamos|troquei|substituímos|substituí|atualizamos|atualizei|corrigindo|correção|na\s+verdade)(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])(?:changed|renamed|switched|replaced|no\s+longer|used\s+to\s+be|actually\s+(?:is|use|uses)|now\s+(?:is|uses|called))(?![\p{L}\p{N}])/iu,
];

export function isTemporalCandidate(content: string): boolean {
  const normalized = content.slice(0, 8_000).normalize('NFKC');
  return CHANGE_SIGNALS.some((signal) => signal.test(normalized));
}
