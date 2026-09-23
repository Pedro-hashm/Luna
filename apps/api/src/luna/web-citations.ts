import type { OrchestratorToolExecution } from '../orchestrator/orchestrator.types';

/** Only URLs tied to persisted web evidence may become citations in a response. */
export function ensureRegisteredWebCitations(
  content: string,
  executions: OrchestratorToolExecution[],
): string {
  const researchResults = executions
    .filter(
      (execution) =>
        execution.tool === 'web_research' &&
        execution.result &&
        'researchRunId' in execution.result,
    )
    .map((execution) => execution.result)
    .filter(
      (
        result,
      ): result is Extract<
        NonNullable<OrchestratorToolExecution['result']>,
        { researchRunId: string }
      > => Boolean(result && 'researchRunId' in result),
    );
  if (researchResults.length === 0) return content;

  const sources = researchResults.flatMap((result) => {
    const evidencedIds = new Set(result.evidence.map((item) => item.sourceId));
    return result.sources.filter(
      (source) =>
        evidencedIds.has(source.id) && /^https?:\/\//iu.test(source.url),
    );
  });
  const allowedUrls = new Set(sources.map((source) => source.url));
  let hasRegisteredCitation = false;
  const sanitizedLinks = content.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/giu,
    (match, label: string, url: string) => {
      if (allowedUrls.has(url)) {
        hasRegisteredCitation = true;
        return match;
      }
      return label;
    },
  );
  const sanitized = sanitizedLinks.replace(
    /https?:\/\/[^\s<>()]+/giu,
    (match) => {
      const url = match.replace(/[.,;!?]+$/u, '');
      return allowedUrls.has(url) ? match : '[link sem fonte verificada]';
    },
  );

  if (hasRegisteredCitation || sources.length === 0) return sanitized;
  const uniqueSources = [
    ...new Map(sources.map((source) => [source.url, source])).values(),
  ].slice(0, 5);
  const references = uniqueSources.map(
    (source) => `[${source.title.replace(/\[|\]/gu, '')}](${source.url})`,
  );
  return `${sanitized.trimEnd()}\n\nFontes: ${references.join(' · ')}`;
}
