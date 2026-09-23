import { BadRequestException, Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import {
  RESEARCH_MODES,
  RESEARCH_RECENCIES,
  type ResearchMode,
  type ResearchRecency,
  type ResearchTask,
} from './dto/research-task.dto';

export interface ResearchRuntimeConfig {
  enabled: boolean;
  combo: string;
  mode: ResearchMode;
  recency: ResearchRecency;
  maxSources: number;
  maxRounds: number;
  maxQueries: number;
  searchProvider: string;
  extractionProvider: string;
  cacheEnabled: boolean;
  browserFallbackEnabled: boolean;
  timeoutMs: number;
  plannerTimeoutMs: number;
  searchTimeoutMs: number;
  extractTimeoutMs: number;
  extractMaxBytes: number;
}

function bound(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  const candidate = value === undefined ? fallback : value;
  if (!Number.isInteger(candidate) || candidate < 1)
    throw new BadRequestException('Research limits must be positive integers');
  return Math.min(candidate, fallback, maximum);
}

function envNumber(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, Math.round(parsed)))
    : fallback;
}

@Injectable()
export class ResearchConfigService {
  constructor(private readonly settings: SettingsService) {}

  async resolve(task: ResearchTask): Promise<ResearchRuntimeConfig> {
    const settings = await this.settings.getApplicationSettings();
    const mode = task.mode ?? settings.researchDefaultMode;
    const recency = task.recency ?? settings.researchDefaultRecency;
    if (!RESEARCH_MODES.includes(mode as ResearchMode))
      throw new BadRequestException('Unsupported research mode');
    if (!RESEARCH_RECENCIES.includes(recency as ResearchRecency))
      throw new BadRequestException('Unsupported research recency');
    const maxRounds = bound(task.maxRounds, settings.researchMaxRounds, 3);
    return {
      enabled: settings.researchEnabled,
      combo: settings.researchSearchOrchestratorCombo,
      mode: mode as ResearchMode,
      recency: recency as ResearchRecency,
      maxSources: bound(task.maxSources, settings.researchMaxSources, 8),
      maxRounds: mode === 'quick' ? 1 : maxRounds,
      maxQueries: bound(task.maxQueries, settings.researchMaxQueries, 5),
      searchProvider: settings.researchSearchProvider,
      extractionProvider: settings.researchExtractionProvider,
      cacheEnabled: settings.researchCacheEnabled,
      browserFallbackEnabled: settings.researchBrowserFallbackEnabled,
      timeoutMs: envNumber('WEB_RESEARCH_TIMEOUT_MS', 80_000, 5_000, 120_000),
      plannerTimeoutMs: envNumber(
        'WEB_RESEARCH_PLANNER_TIMEOUT_MS',
        40_000,
        1_000,
        60_000,
      ),
      searchTimeoutMs: envNumber('WEB_SEARCH_TIMEOUT_MS', 8_000, 500, 30_000),
      extractTimeoutMs: envNumber(
        'WEB_EXTRACT_TIMEOUT_MS',
        9_000,
        1_000,
        30_000,
      ),
      extractMaxBytes: envNumber(
        'WEB_EXTRACT_MAX_BYTES',
        2_000_000,
        100_000,
        10_000_000,
      ),
    };
  }
}
