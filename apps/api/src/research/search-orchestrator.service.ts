import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type {
  ResearchResult,
  ResearchEvidence,
  ResearchSource,
} from './dto/research-result.dto';
import type { ResearchTask } from './dto/research-task.dto';
import type {
  PlannedQuery,
  PlannerOutcome,
  SearchPlan,
} from './search-planner.service';
import {
  ResearchConfigService,
  type ResearchRuntimeConfig,
} from './research-config.service';
import { SearchPlannerService } from './search-planner.service';
import { WebSearchTool } from './tools/web-search.tool';
import { WebExtractTool } from './tools/web-extract.tool';
import { SourceService } from './sources/source.service';
import { ResearchEvidenceService } from './evidence/research-evidence.service';
import { ResearchRunService } from './research-run.service';

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

@Injectable()
export class SearchOrchestratorService {
  private readonly logger = new Logger(SearchOrchestratorService.name);

  constructor(
    private readonly configService: ResearchConfigService,
    private readonly planner: SearchPlannerService,
    private readonly webSearch: WebSearchTool,
    private readonly webExtract: WebExtractTool,
    private readonly sourceService: SourceService,
    private readonly evidenceService: ResearchEvidenceService,
    private readonly runs: ResearchRunService,
  ) {}

  async run(task: ResearchTask): Promise<ResearchResult> {
    if (
      typeof task.question !== 'string' ||
      !task.question.trim() ||
      task.question.length > 2_000
    ) {
      throw new BadRequestException(
        'Research question must contain 1–2000 characters',
      );
    }
    const config = await this.configService.resolve(task);
    if (!config.enabled)
      throw new BadRequestException('Web research is disabled');
    const started = Date.now();
    const runId = await this.runs.create(task, config.mode, config.combo);
    const signal = AbortSignal.any([
      AbortSignal.timeout(config.timeoutMs),
      ...(task.signal ? [task.signal] : []),
    ]);
    const registry = this.sourceService.createRegistry(runId);
    const evidence: ResearchEvidence[] = [];
    const searchedQueries: string[] = [];
    const errors: string[] = [];
    let plannerModel: string | undefined;
    let plannerInputTokens = 0;
    let plannerOutputTokens = 0;
    let llmCalls = 0;
    let rounds = 0;
    let verification = this.evidenceService.verify(evidence, []);

    const metadata = (): ResearchResult['metadata'] => ({
      mode: config.mode,
      rounds,
      searchQueries: searchedQueries.length,
      sourceCount: registry.size(),
      llmCalls,
      plannerCombo: config.combo,
      plannerModel,
      plannerInputTokens,
      plannerOutputTokens,
      latencyMs: Date.now() - started,
      errors,
      verification: verification.decision,
    });

    const recordPlanner = (outcome: PlannerOutcome) => {
      plannerModel = outcome.model;
      plannerInputTokens += outcome.inputTokens;
      plannerOutputTokens += outcome.outputTokens;
    };

    try {
      await this.runs.event(runId, 'research.started', {
        question: task.question,
        mode: config.mode,
        recency: config.recency,
        plannerCombo: config.combo,
        maxRounds: config.maxRounds,
        maxQueries: config.maxQueries,
        maxSources: config.maxSources,
      });
      let plan: SearchPlan;
      await this.runs.event(runId, 'research.planner.started', {
        combo: config.combo,
        round: 1,
        phase: 'initial',
      });
      llmCalls += 1;
      try {
        const outcome = await this.planner.initial(task, config, signal);
        recordPlanner(outcome);
        plan = outcome.plan;
        await this.runs.event(
          runId,
          'research.planner.completed',
          this.plannerEvent(outcome, config, 1),
        );
      } catch (error) {
        errors.push(`planner: ${errorText(error)}`);
        await this.runs.event(runId, 'research.planner.failed', {
          combo: config.combo,
          round: 1,
          error: errorText(error),
          fallback: 'question_as_query',
        });
        plan = {
          action: 'search',
          intention: 'Search the user question directly after planner failure',
          queries: [
            {
              query: task.question.slice(0, 500),
              purpose: 'answer the question',
            },
          ],
          preferredSourceTypes: [],
          needsRecency: config.recency !== 'any',
          maxSources: config.maxSources,
        };
        await this.runs.event(runId, 'research.planner.completed', {
          combo: config.combo,
          round: 1,
          model: 'fallback',
          intention: plan.intention,
          queries: plan.queries,
          inputTokens: 0,
          outputTokens: 0,
          fallback: true,
        });
      }

      for (let round = 1; round <= config.maxRounds; round += 1) {
        signal.throwIfAborted();
        rounds = round;
        await this.runs.event(runId, 'research.round.started', {
          round,
          plannedQueries: plan.queries,
        });
        for (const [queryIndex, query] of plan.queries.entries()) {
          signal.throwIfAborted();
          if (
            searchedQueries.length >= config.maxQueries ||
            registry.size() >= config.maxSources
          )
            break;
          if (
            searchedQueries.some(
              (previous) =>
                previous.toLowerCase() === query.query.toLowerCase(),
            )
          )
            continue;
          const remainingSlots = config.maxSources - registry.size();
          const remainingPlannedQueries = plan.queries
            .slice(queryIndex)
            .filter(
              (candidate) =>
                !searchedQueries.some(
                  (previous) =>
                    previous.toLowerCase() === candidate.query.toLowerCase(),
                ),
            ).length;
          const selectionLimit = Math.ceil(
            remainingSlots / Math.max(remainingPlannedQueries, 1),
          );
          searchedQueries.push(query.query);
          await this.executeQuery(
            runId,
            task.question,
            query,
            round,
            config,
            signal,
            registry,
            evidence,
            errors,
            selectionLimit,
          );
        }

        await this.runs.event(runId, 'research.verification.started', {
          round,
          sourceCount: registry.size(),
          evidenceCount: evidence.length,
        });
        verification = this.evidenceService.verify(evidence, registry.list());
        const canContinue =
          config.mode === 'deep' &&
          round < config.maxRounds &&
          searchedQueries.length < config.maxQueries &&
          registry.size() < config.maxSources &&
          verification.decision !== 'sufficient';
        let nextPlan: SearchPlan | undefined;
        if (canContinue) {
          await this.runs.event(runId, 'research.planner.started', {
            combo: config.combo,
            round: round + 1,
            phase: 'follow_up',
          });
          llmCalls += 1;
          try {
            const outcome = await this.planner.followUp(
              task,
              config,
              {
                round,
                searchedQueries,
                sourceCount: registry.size(),
                evidenceCount: evidence.length,
                gaps: verification.gaps,
                conflicts: verification.conflicts,
              },
              signal,
            );
            recordPlanner(outcome);
            await this.runs.event(
              runId,
              'research.planner.completed',
              this.plannerEvent(outcome, config, round + 1),
            );
            if (
              outcome.plan.action === 'search_more' &&
              outcome.plan.queries.some(
                (query) =>
                  !searchedQueries.some(
                    (previous) =>
                      previous.toLowerCase() === query.query.toLowerCase(),
                  ),
              )
            ) {
              nextPlan = outcome.plan;
            }
          } catch (error) {
            errors.push(`planner follow-up: ${errorText(error)}`);
            await this.runs.event(runId, 'research.planner.failed', {
              combo: config.combo,
              round: round + 1,
              error: errorText(error),
            });
          }
        }
        await this.runs.event(runId, 'research.verification.completed', {
          round,
          decision: verification.decision,
          gaps: verification.gaps,
          conflicts: verification.conflicts,
          newRound: Boolean(nextPlan),
        });
        await this.runs.event(runId, 'research.round.completed', {
          round,
          searchQueries: searchedQueries.length,
          sourceCount: registry.size(),
          evidenceCount: evidence.length,
          decision: verification.decision,
        });
        if (!nextPlan) break;
        plan = nextPlan;
      }

      const summaryContext = this.evidenceService.summary(
        task.question,
        registry.list(),
        evidence,
        verification.conflicts,
      );
      const status: ResearchResult['status'] =
        !evidence.length && errors.length
          ? 'failed'
          : verification.decision === 'insufficient'
            ? 'insufficient'
            : 'completed';
      const result: ResearchResult = {
        researchRunId: runId,
        status,
        summaryContext,
        sources: registry.list(),
        evidence,
        conflicts: verification.conflicts,
        metadata: metadata(),
      };
      await this.runs.event(
        runId,
        status === 'failed' ? 'research.failed' : 'research.completed',
        {
          status,
          decision: verification.decision,
          ...result.metadata,
        },
      );
      await this.runs.complete(runId, status, summaryContext, result.metadata);
      return result;
    } catch (error) {
      const message = errorText(error);
      errors.push(message);
      this.logger.error(`Research run ${runId} failed: ${message}`);
      const summaryContext = this.evidenceService.summary(
        task.question,
        registry.list(),
        evidence,
        verification.conflicts,
      );
      try {
        await this.runs.event(runId, 'research.failed', {
          error: message,
          ...metadata(),
        });
        await this.runs.complete(runId, 'failed', summaryContext, metadata());
      } catch (persistenceError) {
        this.logger.error(
          `Unable to finalize research run ${runId}: ${errorText(persistenceError)}`,
        );
      }
      return {
        researchRunId: runId,
        status: 'failed',
        summaryContext,
        sources: registry.list(),
        evidence,
        conflicts: verification.conflicts,
        metadata: metadata(),
      };
    }
  }

  private async executeQuery(
    runId: string,
    question: string,
    query: PlannedQuery,
    round: number,
    config: ResearchRuntimeConfig,
    signal: AbortSignal,
    registry: ReturnType<SourceService['createRegistry']>,
    evidence: ResearchEvidence[],
    errors: string[],
    selectionLimit: number,
  ): Promise<void> {
    await this.runs.event(runId, 'research.search.started', {
      round,
      query: query.query,
      purpose: query.purpose,
      provider: config.searchProvider,
    });
    let search;
    try {
      search = await this.webSearch.search(query.query, {
        recency: config.recency,
        maxResults: 8,
        timeoutMs: config.searchTimeoutMs,
        cacheEnabled: config.cacheEnabled && config.recency !== 'day',
        signal,
      });
    } catch (error) {
      errors.push(`search ${query.query}: ${errorText(error)}`);
      await this.runs.event(runId, 'research.search.failed', {
        round,
        query: query.query,
        provider: config.searchProvider,
        error: errorText(error),
      });
      return;
    }

    const selection = this.sourceService.select(
      search.results,
      question,
      selectionLimit,
      registry.list(),
      query.query,
    );
    await this.runs.event(runId, 'research.search.completed', {
      round,
      query: query.query,
      provider: search.provider,
      resultCount: search.results.length,
      selectedCount: selection.selected.length,
      rejectedCount: selection.rejected.length,
      latencyMs: search.latencyMs,
      fromCache: search.fromCache,
    });
    for (const item of selection.rejected) {
      await this.runs.event(runId, 'research.source.rejected', {
        round,
        query: query.query,
        sourceId: item.result.id,
        url: item.result.url,
        title: item.result.title,
        domain: item.result.domain,
        rank: item.result.rank,
        reason: item.reason,
      });
    }
    const selectedSources: ResearchSource[] = [];
    for (const item of selection.selected) {
      signal.throwIfAborted();
      const source = registry.register(item.result);
      selectedSources.push(source);
      await this.runs.source(runId, source);
      await this.runs.event(runId, 'research.source.selected', {
        round,
        query: query.query,
        sourceId: source.id,
        url: source.url,
        domain: source.domain,
        title: source.title,
        sourceType: source.sourceType,
        rank: source.rank,
        score: item.score,
        reason: item.reason,
        publishedAt: source.publishedAt ?? null,
        retrievedAt: source.retrievedAt,
      });
    }
    await Promise.all(
      selectedSources.map((source) =>
        this.extractSource(
          runId,
          question,
          source,
          round,
          config,
          signal,
          evidence,
          errors,
        ),
      ),
    );
  }

  private async extractSource(
    runId: string,
    question: string,
    source: ResearchSource,
    round: number,
    config: ResearchRuntimeConfig,
    signal: AbortSignal,
    evidence: ResearchEvidence[],
    errors: string[],
  ): Promise<void> {
    const started = Date.now();
    await this.runs.event(runId, 'research.extract.started', {
      round,
      sourceId: source.id,
      url: source.url,
    });
    try {
      signal.throwIfAborted();
      const document = await this.webExtract.extract(source.url, {
        timeoutMs: config.extractTimeoutMs,
        maxBytes: config.extractMaxBytes,
        browserFallbackEnabled: config.browserFallbackEnabled,
        cacheEnabled: config.cacheEnabled && config.recency !== 'day',
      });
      source.extractionMethod = document.extractionMethod;
      source.title = document.title || source.title;
      source.publishedAt = document.publishedAt ?? source.publishedAt;
      source.metadata = {
        ...source.metadata,
        finalUrl: document.finalUrl,
        wordCount: document.wordCount,
      };
      await this.runs.source(runId, source);
      await this.runs.event(runId, 'research.extract.completed', {
        round,
        sourceId: source.id,
        method: document.extractionMethod,
        browserFallback: document.extractionMethod === 'browser',
        contentLength: document.text.length,
        wordCount: document.wordCount,
        latencyMs: Date.now() - started,
      });
      for (const item of this.evidenceService.mapDocument(
        runId,
        question,
        source,
        document,
      )) {
        await this.runs.evidence(runId, item);
        evidence.push(item);
        await this.runs.event(runId, 'research.evidence.created', {
          round,
          evidenceId: item.id,
          sourceId: item.sourceId,
          text: item.text,
          type: item.type,
          location: item.location,
        });
      }
    } catch (error) {
      errors.push(`extract ${source.url}: ${errorText(error)}`);
      await this.runs.event(runId, 'research.extract.failed', {
        round,
        sourceId: source.id,
        url: source.url,
        error: errorText(error),
        latencyMs: Date.now() - started,
      });
    }
  }

  private plannerEvent(
    outcome: PlannerOutcome,
    config: ResearchRuntimeConfig,
    round: number,
  ): Record<string, unknown> {
    return {
      round,
      combo: config.combo,
      model: outcome.model,
      intention: outcome.plan.intention,
      action: outcome.plan.action,
      queries: outcome.plan.queries,
      preferredSourceTypes: outcome.plan.preferredSourceTypes,
      needsRecency: outcome.plan.needsRecency,
      maxSources: outcome.plan.maxSources,
      inputTokens: outcome.inputTokens,
      outputTokens: outcome.outputTokens,
      prompt: outcome.prompt.slice(0, 8_000),
    };
  }
}
