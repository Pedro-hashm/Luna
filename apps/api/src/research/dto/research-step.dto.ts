export type ResearchEventType =
  | 'research.started'
  | 'research.planner.started'
  | 'research.planner.completed'
  | 'research.planner.failed'
  | 'research.round.started'
  | 'research.round.completed'
  | 'research.search.started'
  | 'research.search.completed'
  | 'research.search.failed'
  | 'research.source.selected'
  | 'research.source.rejected'
  | 'research.extract.started'
  | 'research.extract.completed'
  | 'research.extract.failed'
  | 'research.evidence.created'
  | 'research.verification.started'
  | 'research.verification.completed'
  | 'research.completed'
  | 'research.failed';

export interface ResearchEvent {
  id: string;
  sequence: number;
  type: ResearchEventType;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface ResearchRunView {
  id: string;
  conversationId: string | null;
  messageId: string | null;
  requestId: string | null;
  question: string;
  status: string;
  mode: string;
  plannerCombo: string;
  summaryContext: string | null;
  metadata: Record<string, unknown> | null;
  startedAt: string;
  completedAt: string | null;
  events: ResearchEvent[];
  sources: Array<Record<string, unknown>>;
  evidence: Array<Record<string, unknown>>;
}
