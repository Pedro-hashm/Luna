"use client";

import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Bot,
  Brain,
  CheckCircle2,
  Clock3,
  Database,
  FileText,
  Gauge,
  Globe2,
  Layers3,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { BrainFlow } from "@/components/observability/brain-flow";
import { ResearchRunInspector } from "@/components/observability/research-run-inspector";
import {
  getConversationInspector,
  getConversationResearchRuns,
  getConversations,
  getObservabilityMetrics,
  getResearchRun,
  type ContextPart,
  type ConversationInspector,
  type ConversationListItem,
  type ObservabilityMetrics,
  type ResearchRunView,
} from "@/lib/conversation-api";

const emptyMetrics: ObservabilityMetrics = {
  period: { from: "", to: "", timeZone: "America/Sao_Paulo" },
  summary: {
    requests: 0,
    llmRequests: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    averageLatencyMs: 0,
    errors: 0,
    timeouts: 0,
  },
  byDay: [],
  byStage: [],
  byModel: [],
  recent: [],
};

export default function ObservabilityPage() {
  const [activeSection, setActiveSection] = useState<"metrics" | "flow" | "research" | "prompts">("metrics");
  const [rangeDays, setRangeDays] = useState(14);
  const [metrics, setMetrics] = useState<ObservabilityMetrics>();
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string>();
  const [inspector, setInspector] = useState<ConversationInspector>();
  const [activeTraceId, setActiveTraceId] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [researchRuns, setResearchRuns] = useState<ResearchRunView[]>([]);
  const [selectedResearchRunId, setSelectedResearchRunId] = useState<string>();
  const [researchRun, setResearchRun] = useState<ResearchRunView>();
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchError, setResearchError] = useState<string>();
  const [researchRefreshToken, setResearchRefreshToken] = useState(0);

  useEffect(() => {
    let isCurrent = true;

    const loadDashboard = async () => {
      setIsLoading(true);
      try {
        const [nextMetrics, nextConversations] = await Promise.all([
          getObservabilityMetrics({ from: dateFromDaysAgo(rangeDays) }),
          getConversations(),
        ]);

        if (!isCurrent) return;

        setMetrics(nextMetrics);
        setConversations(nextConversations);
        const queryConversation = new URLSearchParams(window.location.search).get("conversation");
        const queryView = new URLSearchParams(window.location.search).get("view");
        setSelectedConversationId(
          queryConversation && nextConversations.some((item) => item.id === queryConversation)
            ? queryConversation
            : nextConversations[0]?.id,
        );
        if (queryView === "research") {
          setResearchLoading(true);
          setActiveSection("research");
        }
        setError(undefined);
      } catch (requestError) {
        if (isCurrent) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Não foi possível carregar as métricas.",
          );
        }
      } finally {
        if (isCurrent) setIsLoading(false);
      }
    };

    void loadDashboard();
    return () => {
      isCurrent = false;
    };
  }, [rangeDays]);

  useEffect(() => {
    if (!selectedConversationId) {
      return;
    }

    let isCurrent = true;

    void getConversationInspector(selectedConversationId)
      .then((response) => {
        if (isCurrent) {
          setInspector(response);
          const latestToolTrace = [...response.responses].reverse().find((trace) => trace.kind === "tool");
          setActiveTraceId(latestToolTrace?.traceId ?? response.responses.at(-1)?.traceId);
        }
      })
      .catch((requestError) => {
        if (isCurrent) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Não foi possível carregar o inspector.",
          );
        }
      });
    return () => {
      isCurrent = false;
    };
  }, [selectedConversationId]);

  useEffect(() => {
    if (activeSection !== "research" || !selectedConversationId) return;
    let isCurrent = true;
    void getConversationResearchRuns(selectedConversationId)
      .then(({ runs }) => {
        if (!isCurrent) return;
        setResearchRuns(runs);
        setSelectedResearchRunId(runs[0]?.id);
        setResearchLoading(runs.length > 0);
        setResearchError(undefined);
      })
      .catch((requestError) => {
        if (!isCurrent) return;
        setResearchRuns([]);
        setResearchLoading(false);
        setResearchError(requestError instanceof Error ? requestError.message : "Não foi possível carregar as pesquisas.");
      });
    return () => { isCurrent = false; };
  }, [activeSection, selectedConversationId, researchRefreshToken]);

  useEffect(() => {
    if (activeSection !== "research" || !selectedResearchRunId) return;
    let isCurrent = true;
    void getResearchRun(selectedResearchRunId)
      .then((run) => {
        if (!isCurrent) return;
        setResearchRun(run);
        setResearchLoading(false);
        setResearchError(undefined);
      })
      .catch((requestError) => {
        if (!isCurrent) return;
        setResearchLoading(false);
        setResearchError(requestError instanceof Error ? requestError.message : "Não foi possível carregar a execução da pesquisa.");
      });
    return () => { isCurrent = false; };
  }, [activeSection, selectedResearchRunId, researchRefreshToken]);

  const currentMetrics = metrics ?? emptyMetrics;
  const maxStageMs = Math.max(1, ...currentMetrics.byStage.map((stage) => stage.totalMs));
  const activeTrace = inspector?.responses.find((trace) => trace.traceId === activeTraceId);
  const isInspectorLoading = Boolean(
    selectedConversationId && inspector?.conversation.id !== selectedConversationId,
  );

  return (
    <main className="h-dvh overflow-y-auto px-4 py-4 sm:px-7 sm:py-7">
      <div className="pointer-events-none fixed -left-32 top-4 size-96 rounded-full bg-indigo-200/35 blur-3xl" />
      <div className="pointer-events-none fixed -bottom-24 right-0 size-[30rem] rounded-full bg-violet-200/35 blur-3xl" />

      <div className="relative mx-auto max-w-[1600px]">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              aria-label="Voltar para a conversa"
              className="flex size-10 items-center justify-center rounded-xl bg-slate-900 text-white shadow-lg shadow-slate-500/20 transition hover:-translate-y-px hover:bg-slate-700"
              href="/"
            >
              <ArrowLeft className="size-4" />
            </Link>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-600">
                Luna · observabilidade
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
                {activeSection === "metrics" ? "Métricas e contexto" : activeSection === "flow" ? "Fluxo e inspectors" : activeSection === "research" ? "Pesquisa na Web" : "Prompts recebidos"}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activeSection === "metrics" ? (
              <select
                aria-label="Período das métricas"
                className="h-10 rounded-xl border border-white/85 bg-white/65 px-3 text-xs font-medium text-slate-700 shadow-sm outline-none focus:border-indigo-200"
                onChange={(event) => setRangeDays(Number(event.target.value))}
                value={rangeDays}
              >
                <option value={7}>Últimos 7 dias</option>
                <option value={14}>Últimos 14 dias</option>
                <option value={30}>Últimos 30 dias</option>
                <option value={90}>Últimos 90 dias</option>
              </select>
            ) : null}
            <Link
              className="hidden rounded-xl border border-white/80 bg-white/65 px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:-translate-y-px hover:bg-white sm:inline-flex"
              href="/settings"
            >
              Configurações
            </Link>
          </div>
        </header>

        {error ? (
          <div className="mb-5 flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50/80 px-4 py-3 text-sm text-red-700">
            <TriangleAlert className="size-4 shrink-0" />
            {error}
          </div>
        ) : null}

        <section className="glass mb-6 rounded-[1.7rem] p-5 sm:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Activity className="size-4 text-indigo-600" />
                Visão do runtime
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Um painel técnico, integrado ao sistema visual da Luna, para entender custo, latência e contexto sem alterar o fluxo da conversa.
              </p>
            </div>
            <div className="max-w-xl rounded-2xl border border-indigo-100/80 bg-indigo-50/45 px-4 py-3 text-xs leading-5 text-slate-600">
              <span className="font-semibold text-indigo-700">Dados do runtime:</span> tokens são estimados quando o provedor não informa usage. A seção Prompts recebidos mostra as mensagens exatas salvas em cada execução.
            </div>
          </div>
        </section>

        <nav aria-label="Seções de observabilidade" className="mb-5 flex flex-wrap gap-2 rounded-2xl border border-white/80 bg-white/45 p-2 shadow-sm">
          {([
            ["metrics", "Métricas", BarChart3],
            ["flow", "Fluxo e inspectors", Brain],
            ["research", "Pesquisa na Web", Globe2],
            ["prompts", "Prompts recebidos", FileText],
          ] as const).map(([section, label, Icon]) => (
            <button
              aria-current={activeSection === section ? "page" : undefined}
              className={`inline-flex min-h-10 items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition ${activeSection === section ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/15" : "text-slate-600 hover:bg-white/80 hover:text-slate-900"}`}
              key={section}
              onClick={() => {
                if (section === "research") {
                  setResearchLoading(true);
                  setResearchRun(undefined);
                  setResearchError(undefined);
                }
                setActiveSection(section);
              }}
              type="button"
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </nav>

        {isLoading ? (
          <div className="glass flex min-h-64 items-center justify-center gap-3 rounded-[1.7rem] text-sm text-slate-500">
            <LoaderCircle className="size-4 animate-spin" />
            Carregando métricas
          </div>
        ) : (
          <>
            {activeSection === "metrics" ? (
              <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard icon={Activity} label="Requests" value={formatNumber(currentMetrics.summary.requests)} detail={`${currentMetrics.summary.llmRequests} respostas · ${currentMetrics.summary.toolCalls} tools`} />
              <MetricCard icon={Layers3} label="Tokens" value={formatTokens(currentMetrics.summary.totalTokens)} detail={`${formatTokens(currentMetrics.summary.inputTokens)} input · ${formatTokens(currentMetrics.summary.outputTokens)} output`} />
              <MetricCard icon={Clock3} label="Latência média" value={formatDuration(currentMetrics.summary.averageLatencyMs)} detail={`${currentMetrics.summary.llmRequests} chamadas de LLM`} />
              <MetricCard icon={currentMetrics.summary.errors ? TriangleAlert : CheckCircle2} label="Saúde" value={`${currentMetrics.summary.errors + currentMetrics.summary.timeouts}`} detail={`${currentMetrics.summary.errors} erros · ${currentMetrics.summary.timeouts} timeouts`} tone={currentMetrics.summary.errors ? "warning" : "default"} />
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.8fr)]">
              <section className="glass rounded-[1.7rem] p-5 sm:p-7">
                <SectionHeading icon={BarChart3} eyebrow="Período" title="Requests por dia" description={`Fuso ${currentMetrics.period.timeZone}`} />
                <div className="mt-7 flex h-56 items-end gap-2 border-b border-slate-200/80 pb-0 sm:gap-3">
                  {currentMetrics.byDay.length === 0 ? (
                    <EmptyChart />
                  ) : (
                    currentMetrics.byDay.map((day) => (
                      <div className="flex min-w-0 flex-1 flex-col items-center justify-end gap-2" key={day.date}>
                        <span className="text-[10px] font-semibold text-slate-500">{day.requests}</span>
                        <div className="flex w-full max-w-10 items-end gap-0.5" style={{ height: "9rem" }}>
                          <div className="w-1/2 rounded-t-md bg-indigo-400/80 transition-all" style={{ height: `${Math.max(4, (day.inputTokens / Math.max(1, currentMetrics.summary.inputTokens)) * 100)}%` }} title={`${formatNumber(day.inputTokens)} tokens de input`} />
                          <div className="w-1/2 rounded-t-md bg-violet-300/90 transition-all" style={{ height: `${Math.max(4, (day.outputTokens / Math.max(1, currentMetrics.summary.outputTokens)) * 100)}%` }} title={`${formatNumber(day.outputTokens)} tokens de output`} />
                        </div>
                        <span className="truncate text-[10px] text-slate-400">{shortDate(day.date)}</span>
                      </div>
                    ))
                  )}
                </div>
                <div className="mt-4 flex items-center gap-4 text-[10px] text-slate-500">
                  <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-indigo-400/80" />Input tokens</span>
                  <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-violet-300" />Output tokens</span>
                  <span className="ml-auto">{formatNumber(Math.max(...currentMetrics.byDay.map((day) => day.requests), 0))} pico de requests</span>
                </div>
              </section>

              <section className="glass rounded-[1.7rem] p-5 sm:p-7">
                <SectionHeading icon={Gauge} eyebrow="Pipeline" title="Tempo por etapa" description="Onde a request passou mais tempo" />
                <div className="mt-7 space-y-4">
                  {currentMetrics.byStage.length === 0 ? <EmptyInline label="Ainda não há etapas registradas." /> : currentMetrics.byStage.map((stage) => (
                    <div key={stage.stage}>
                      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                        <span className="truncate font-medium text-slate-700">{stageLabel(stage.stage)}</span>
                        <span className="shrink-0 text-slate-500">{formatDuration(stage.totalMs)}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-200/70">
                        <div className="h-full rounded-full bg-indigo-400/80" style={{ width: `${Math.max(5, (stage.totalMs / maxStageMs) * 100)}%` }} />
                      </div>
                      <p className="mt-1 text-[10px] text-slate-400">média {formatDuration(stage.averageMs)}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <section className="glass rounded-[1.7rem] p-5 sm:p-7">
                <SectionHeading icon={Bot} eyebrow="Modelos" title="Combo utilizado" description="Distribuição das chamadas observadas" />
                <div className="mt-6 space-y-3">
                  {currentMetrics.byModel.length === 0 ? <EmptyInline label="Nenhum modelo observado neste período." /> : currentMetrics.byModel.map((model) => (
                    <div className="rounded-2xl border border-white/80 bg-white/45 p-3" key={`${model.combo}-${model.model}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-slate-800">{model.combo}</p>
                          <p className="mt-1 truncate text-[10px] text-slate-500">{model.model}</p>
                        </div>
                        <span className="shrink-0 rounded-lg bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-700">{model.requests}x</span>
                      </div>
                      <div className="mt-2 flex gap-3 text-[10px] text-slate-500">
                        <span>{formatDuration(model.averageLatencyMs)} média</span>
                        <span>{formatTokens(model.inputTokens + model.outputTokens)} tokens</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="glass rounded-[1.7rem] p-5 sm:p-7">
                <SectionHeading icon={RefreshCw} eyebrow="Atividade" title="Últimas execuções" description="LLM e tools persistidos como traces" />
                <div className="scrollbar-subtle mt-5 max-h-72 space-y-2 overflow-y-auto pr-1">
                  {currentMetrics.recent.length === 0 ? <EmptyInline label="As próximas requests aparecerão aqui." /> : currentMetrics.recent.map((trace) => (
                    <button
                      className="flex w-full items-center gap-3 rounded-xl border border-white/75 bg-white/42 px-3 py-2.5 text-left transition hover:bg-white/75 disabled:cursor-default"
                      disabled={!trace.conversationId}
                      key={trace.id}
                      onClick={() => {
                        if (!trace.conversationId) return;
                        setSelectedConversationId(trace.conversationId);
                        if (trace.toolName === "web_research") {
                          setResearchLoading(true);
                          setResearchRun(undefined);
                        }
                        setActiveSection(trace.toolName === "web_research" ? "research" : "flow");
                      }}
                      type="button"
                    >
                      <TraceStatus status={trace.status} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-slate-700">{trace.kind === "tool" ? trace.toolName ?? "Tool" : trace.model ?? trace.combo ?? "LLM"}</p>
                        <p className="mt-0.5 truncate text-[10px] text-slate-400">{trace.conversationId ? "Abrir inspector" : "Sem conversa vinculada"} · {formatDateTime(trace.createdAt)}</p>
                      </div>
                      <span className="shrink-0 text-[10px] text-slate-500">{formatDuration(trace.latencyMs)}</span>
                    </button>
                  ))}
                </div>
              </section>
            </div>
              </>
            ) : null}

            {activeSection === "flow" ? (
              <>
            <section className="glass mt-6 rounded-[1.7rem] p-5 sm:p-7">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <SectionHeading icon={Brain} eyebrow="Fluxo" title="Cérebro da Luna" description="Os nós futuros permanecem visíveis, mas só acendem quando houver implementação observada." />
                <BrainFlow activeStage={activeTrace?.kind === "tool" ? "tools" : activeTrace ? promptTargetForTrace(activeTrace) ?? "luna" : undefined} completedStages={activeTrace ? ["user", "context"] : []} />
              </div>
            </section>

            <section className="mt-6 grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
              <section className="glass rounded-[1.7rem] p-5 sm:p-6">
                <SectionHeading icon={MessageSquare} eyebrow="Inspector" title="Escolha uma conversa" description="Veja o contexto registrado para cada resposta." />
                <div className="scrollbar-subtle mt-5 max-h-[32rem] space-y-2 overflow-y-auto pr-1">
                  {conversations.length === 0 ? <EmptyInline label="Nenhuma conversa disponível." /> : conversations.map((conversation) => (
                    <button
                      className={`w-full rounded-xl border p-3 text-left transition ${conversation.id === selectedConversationId ? "border-indigo-200 bg-indigo-50/75" : "border-white/80 bg-white/42 hover:bg-white/75"}`}
                      key={conversation.id}
                      onClick={() => setSelectedConversationId(conversation.id)}
                      type="button"
                    >
                      <p className="truncate text-xs font-semibold text-slate-800">{conversation.title}</p>
                      <p className="mt-1 truncate text-[10px] text-slate-500">{conversation.messageCount} mensagens · {formatDateTime(conversation.updatedAt)}</p>
                    </button>
                  ))}
                </div>
              </section>

              <section className="glass min-w-0 rounded-[1.7rem] p-5 sm:p-7">
                {isInspectorLoading ? (
                  <div className="flex min-h-56 items-center justify-center gap-3 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" />Carregando contexto</div>
                ) : inspector ? (
                  <Inspector inspector={inspector} activeTraceId={activeTraceId} onSelectTrace={setActiveTraceId} />
                ) : (
                  <div className="flex min-h-56 flex-col items-center justify-center text-center"><Database className="size-6 text-slate-400" /><p className="mt-3 text-sm font-medium text-slate-700">Selecione uma conversa</p><p className="mt-1 text-xs text-slate-500">As respostas e o contexto aparecerão aqui.</p></div>
                )}
              </section>
            </section>
              </>
            ) : null}

            {activeSection === "research" ? (
              <section className="mt-6 grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
                <section className="glass rounded-[1.7rem] p-5 sm:p-6">
                  <SectionHeading icon={MessageSquare} eyebrow="Pesquisa na Web" title="Escolha uma conversa" description="Selecione a conversa que originou uma execução." />
                  <div className="scrollbar-subtle mt-5 max-h-72 space-y-2 overflow-y-auto pr-1">
                    {conversations.length === 0 ? <EmptyInline label="Nenhuma conversa disponível." /> : conversations.map((conversation) => (
                      <button
                        className={`w-full rounded-xl border p-3 text-left transition ${conversation.id === selectedConversationId ? "border-indigo-200 bg-indigo-50/75" : "border-white/80 bg-white/42 hover:bg-white/75"}`}
                        key={conversation.id}
                        onClick={() => {
                          setResearchLoading(true);
                          setResearchRun(undefined);
                          setResearchRuns([]);
                          setSelectedResearchRunId(undefined);
                          setSelectedConversationId(conversation.id);
                        }}
                        type="button"
                      >
                        <p className="truncate text-xs font-semibold text-slate-800">{conversation.title}</p>
                        <p className="mt-1 truncate text-[10px] text-slate-500">{conversation.messageCount} mensagens · {formatDateTime(conversation.updatedAt)}</p>
                      </button>
                    ))}
                  </div>
                  <div className="mt-5 flex items-center justify-between gap-2 border-t border-white/80 pt-4">
                    <p className="text-xs font-semibold text-slate-700">Execuções · {researchRuns.length}</p>
                    <button aria-label="Atualizar pesquisas" className="rounded-lg p-1.5 text-indigo-600 transition hover:bg-white/80 disabled:opacity-50" disabled={!selectedConversationId || researchLoading} onClick={() => { setResearchLoading(true); setResearchRun(undefined); setResearchError(undefined); setResearchRefreshToken((value) => value + 1); }} type="button"><RefreshCw className={`size-3.5 ${researchLoading ? "animate-spin" : ""}`} /></button>
                  </div>
                  <div className="scrollbar-subtle mt-3 max-h-[32rem] space-y-2 overflow-y-auto pr-1">
                    {researchRuns.map((run) => <button className={`w-full rounded-xl border p-3 text-left transition ${run.id === selectedResearchRunId ? "border-indigo-200 bg-indigo-50/75" : "border-white/80 bg-white/42 hover:bg-white/75"}`} key={run.id} onClick={() => { setResearchLoading(true); setResearchRun(undefined); setSelectedResearchRunId(run.id); }} type="button"><div className="flex items-center justify-between gap-2"><p className="truncate text-xs font-semibold text-slate-800">{run.question}</p>{run.status === "completed" ? <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" /> : run.status === "failed" ? <XCircle className="size-3.5 shrink-0 text-red-500" /> : <Clock3 className="size-3.5 shrink-0 text-amber-500" />}</div><p className="mt-1 text-[10px] text-slate-500">{formatDateTime(run.startedAt)} · {run.plannerCombo} · {run.mode}</p></button>)}
                    {!researchLoading && !researchError && researchRuns.length === 0 ? <EmptyInline label="Nenhuma pesquisa registrada nesta conversa." /> : null}
                  </div>
                </section>
                <section className="glass min-w-0 rounded-[1.7rem] p-5 sm:p-7">
                  {researchError ? <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"><TriangleAlert className="size-3.5 shrink-0" />{researchError}</div> : null}
                  {researchLoading ? <div className="flex min-h-56 items-center justify-center gap-3 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" />Carregando execução</div> : researchRun ? <ResearchRunInspector run={researchRun} /> : !researchError ? <div className="flex min-h-56 flex-col items-center justify-center text-center"><Globe2 className="size-6 text-slate-400" /><p className="mt-3 text-sm font-medium text-slate-700">Selecione uma pesquisa</p><p className="mt-1 text-xs text-slate-500">Planner, buscas, fontes, evidências e eventos aparecerão aqui.</p></div> : null}
                </section>
              </section>
            ) : null}

            {activeSection === "prompts" ? (
              <PromptInspectorSection
                conversations={conversations}
                inspector={inspector}
                isLoading={isInspectorLoading}
                onSelectConversation={setSelectedConversationId}
                onSelectTrace={setActiveTraceId}
                selectedConversationId={selectedConversationId}
                selectedTraceId={activeTraceId}
              />
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}

function Inspector({
  inspector,
  activeTraceId,
  onSelectTrace,
}: {
  inspector: ConversationInspector;
  activeTraceId?: string;
  onSelectTrace: (traceId: string) => void;
}) {
  const activeTrace = inspector.responses.find((trace) => trace.traceId === activeTraceId) ?? inspector.responses.at(-1);
  const maxContext = Math.max(1, activeTrace?.context.totalTokens ?? 0, ...(activeTrace ? contextContributions(activeTrace.context).map((part) => part.tokens) : []));

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SectionHeading icon={Sparkles} eyebrow="Conversation inspector" title={inspector.conversation.title} description="Cada trace vincula a resposta, tokens, etapas e composição do contexto." />
        <span className="rounded-lg bg-indigo-50 px-2.5 py-1.5 text-[10px] font-semibold text-indigo-700">{inspector.responses.length} traces</span>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <SmallStat label="Mensagens" value={formatNumber(inspector.statistics.messageCount)} />
        <SmallStat label="Tokens" value={formatTokens(inspector.statistics.tokenCount)} />
        <SmallStat label="Duração" value={formatDuration(inspector.statistics.durationMs)} />
        <SmallStat label="Tools" value={formatNumber(inspector.statistics.toolsUsed)} />
        <SmallStat label="Memórias" value={formatNumber(inspector.statistics.memoriesRecovered)} />
        <SmallStat label="Relacionadas" value={formatNumber(inspector.statistics.relatedConversations)} />
      </div>

      {inspector.responses.length === 0 ? <div className="mt-7 rounded-2xl border border-dashed border-white/90 bg-white/30 px-4 py-10 text-center text-xs text-slate-500">Ainda não há traces para esta conversa.</div> : (
        <div className="mt-6 grid gap-5 lg:grid-cols-[210px_minmax(0,1fr)]">
          <div className="space-y-2">
            {inspector.responses.map((trace, index) => (
              <button className={`w-full rounded-xl border p-3 text-left transition ${trace.traceId === activeTrace?.traceId ? "border-indigo-200 bg-indigo-50/75" : "border-white/80 bg-white/42 hover:bg-white/70"}`} key={trace.traceId} onClick={() => onSelectTrace(trace.traceId)} type="button">
                <div className="flex items-center justify-between gap-2"><span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{trace.kind === "tool" ? "Tool" : `Resposta ${index + 1}`}</span><TraceStatus status={trace.status} /></div>
                <p className="mt-2 truncate text-xs font-medium text-slate-700">{trace.toolName ?? trace.model ?? trace.combo ?? "Execução"}</p>
                <p className="mt-1 text-[10px] text-slate-400">{formatDateTime(trace.createdAt)} · {formatDuration(trace.latencyMs)}</p>
              </button>
            ))}
          </div>

          {activeTrace ? (
            <div className="min-w-0">
              <div className="rounded-2xl border border-white/80 bg-white/45 p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500"><TraceStatus status={activeTrace.status} /><span>{activeTrace.combo ?? "Sem combo"}</span><span>·</span><span>{activeTrace.model ?? activeTrace.toolName ?? "Sem modelo"}</span><span>·</span><span>{formatDateTime(activeTrace.createdAt)}</span></div>
                {activeTrace.response ? <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-800">{activeTrace.response.content}</p> : <p className="mt-4 text-sm text-slate-500">Esta execução não produziu uma resposta de LLM.</p>}
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-white/80 bg-white/42 p-4">
                  <div className="flex items-center justify-between"><p className="text-xs font-semibold text-slate-800">Contribuição do contexto</p><span className="text-[10px] text-slate-500">{formatTokens(activeTrace.context.totalTokens ?? activeTrace.inputTokens)} total</span></div>
                  <div className="mt-4 space-y-3">{contextContributions(activeTrace.context).map((part) => <ContextContribution key={part.label} part={part} max={maxContext} />)}</div>
                </div>
                <div className="rounded-2xl border border-white/80 bg-white/42 p-4">
                  <p className="text-xs font-semibold text-slate-800">Tokens e etapas</p>
                  <div className="mt-4 grid grid-cols-2 gap-2"><SmallStat label="Input real/estimado" value={`${formatTokens(activeTrace.inputTokens)} / ${formatTokens(activeTrace.estimatedInputTokens)}`} /><SmallStat label="Output real/estimado" value={`${formatTokens(activeTrace.outputTokens)} / ${formatTokens(activeTrace.estimatedOutputTokens)}`} /><SmallStat label="Total" value={formatTokens(activeTrace.totalTokens)} /><SmallStat label="Latência" value={formatDuration(activeTrace.latencyMs)} /></div>
                  <div className="mt-4 space-y-2">{Object.entries(activeTrace.stages).map(([stage, value]) => <div className="flex items-center justify-between text-[11px] text-slate-500" key={stage}><span>{stageLabel(stage)}</span><span className="font-semibold text-slate-700">{formatDuration(value)}</span></div>)}</div>
                </div>
              </div>
              <ContextDetails context={activeTrace.context} />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function PromptInspectorSection({
  conversations,
  inspector,
  isLoading,
  onSelectConversation,
  onSelectTrace,
  selectedConversationId,
  selectedTraceId,
}: {
  conversations: ConversationListItem[];
  inspector?: ConversationInspector;
  isLoading: boolean;
  onSelectConversation: (conversationId: string) => void;
  onSelectTrace: (traceId: string) => void;
  selectedConversationId?: string;
  selectedTraceId?: string;
}) {
  const promptTraces = (inspector?.responses ?? []).filter((trace) => promptTargetForTrace(trace));
  const activeTrace = promptTraces.find((trace) => trace.traceId === selectedTraceId) ?? promptTraces.at(-1);
  const target = activeTrace ? promptTargetForTrace(activeTrace) : undefined;
  const messages = activeTrace?.context.promptMessages;

  return (
    <section className="glass rounded-[1.7rem] p-5 sm:p-7">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <SectionHeading
          icon={FileText}
          eyebrow="Prompt inspector · somente leitura"
          title="Mensagens recebidas pelos modelos"
          description="Cada cartão corresponde a uma mensagem enviada ao provedor. A numeração preserva exatamente a ordem e o conteúdo da execução selecionada."
        />
        <label className="grid gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          Conversa
          <select
            aria-label="Conversa dos prompts"
            className="h-10 min-w-64 rounded-xl border border-white/85 bg-white/70 px-3 text-xs font-medium normal-case tracking-normal text-slate-700 shadow-sm outline-none focus:border-indigo-200"
            onChange={(event) => event.target.value && onSelectConversation(event.target.value)}
            value={selectedConversationId ?? ""}
          >
            {conversations.length === 0 ? <option value="">Nenhuma conversa disponível</option> : null}
            {conversations.map((conversation) => (
              <option key={conversation.id} value={conversation.id}>{conversation.title}</option>
            ))}
          </select>
        </label>
      </div>

      {isLoading ? (
        <div className="mt-6 flex min-h-48 items-center justify-center gap-3 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" />Carregando traces e prompts</div>
      ) : !inspector ? (
        <div className="mt-6"><EmptyInline label="Selecione uma conversa para inspecionar os prompts." /></div>
      ) : promptTraces.length === 0 ? (
        <div className="mt-6"><EmptyInline label="Esta conversa não tem execuções do Orchestrator ou da Luna registradas." /></div>
      ) : (
        <div className="mt-6 grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="min-w-0">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Execuções de LLM</p>
            <div className="scrollbar-subtle max-h-[36rem] space-y-2 overflow-y-auto pr-1">
              {promptTraces.map((trace, index) => {
                const traceTarget = promptTargetForTrace(trace);
                const isSelected = trace.traceId === activeTrace?.traceId;
                return (
                  <button
                    aria-pressed={isSelected}
                    className={`w-full rounded-xl border p-3 text-left transition ${isSelected ? "border-indigo-200 bg-indigo-50/75" : "border-white/80 bg-white/42 hover:bg-white/75"}`}
                    key={trace.traceId}
                    onClick={() => onSelectTrace(trace.traceId)}
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-indigo-600">{traceTarget === "orchestrator" ? "Orchestrator" : "Luna"}</span>
                      <TraceStatus status={trace.status} />
                    </div>
                    <p className="mt-2 truncate text-xs font-medium text-slate-700">{trace.model ?? trace.combo ?? `Execução ${index + 1}`}</p>
                    <p className="mt-1 text-[10px] text-slate-400">{formatDateTime(trace.createdAt)} · {formatDuration(trace.latencyMs)}</p>
                    <p className="mt-1 text-[10px] text-slate-500">{trace.context.promptMessages?.length ?? 0} mensagem(ns){trace.context.promptIteration ? ` · iteração ${trace.context.promptIteration}` : ""}</p>
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="min-w-0">
            {activeTrace ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-indigo-100/80 bg-indigo-50/45 p-4">
                  <div>
                    <p className="text-xs font-semibold text-slate-800">{target === "orchestrator" ? "Prompt do Orchestrator" : "Prompt da Luna"}</p>
                    <p className="mt-1 text-[10px] leading-5 text-slate-500">{inspector.conversation.title} · {activeTrace.combo ?? "combo indisponível"} · {activeTrace.model ?? "modelo indisponível"}</p>
                  </div>
                  <span className="rounded-lg bg-white/80 px-2.5 py-1.5 text-[10px] font-semibold text-slate-600">{messages?.length ?? 0} mensagem(ns) · entrada {formatTokens(activeTrace.inputTokens)} tokens</span>
                </div>

                {target ? <PromptStructure target={target} /> : null}

                {messages?.length ? (
                  <div className="mt-4 space-y-3">
                    {messages.map((message, index) => (
                      <article className="overflow-hidden rounded-2xl border border-white/85 bg-white/60" key={`${index}-${message.role}`}>
                        <header className="flex items-center justify-between gap-3 border-b border-slate-200/70 bg-slate-50/80 px-4 py-2.5">
                          <div className="min-w-0">
                            <span className="text-[11px] font-semibold text-slate-700">Mensagem {String(index + 1).padStart(2, "0")}</span>
                          <span className="ml-2 text-[10px] text-slate-500">{promptMessageLabel(target ?? "luna", index, message.content)}</span>
                          </div>
                          <span className="shrink-0 rounded-md bg-indigo-50 px-2 py-1 font-mono text-[10px] font-semibold text-indigo-700">{message.role}</span>
                        </header>
                        <pre className="scrollbar-subtle max-h-[34rem] overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-[11px] leading-5 text-slate-700">{message.content}</pre>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-xs leading-5 text-amber-900">
                    O prompt exato não foi persistido para este trace antigo. Os dados já gravados não permitem reconstruir com segurança a ordem integral; traces novos passam a salvar a sequência original de mensagens.
                  </div>
                )}
              </>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

function PromptStructure({ target }: { target: "orchestrator" | "luna" }) {
  const entries = target === "orchestrator"
    ? [
        ["Fixo", "Instruções do Orchestrator", "Regras de decisão e protocolo de saída; as regras de Evidence entram quando esse recurso está ativo."],
        ["Fixo", "Ferramentas registradas", "Descrições e esquemas das tools disponíveis nesta execução."],
        ["Fixo", "Estado operacional", "Horário local, número da iteração, chamadas feitas e resultados anteriores de tools."],
        ["Variável", "Contexto recente", "Mensagens recentes da conversa, incluindo Evidence associada quando existir."],
      ]
    : [
        ["Fixo", "Instruções base da Luna", "Regras de resposta e uso do contexto confiável."],
        ["Fixo", "Data e hora local", "Horário da iteração no fuso configurado."],
        ["Condicional", "Orientação operacional do Orchestrator", "Incluída quando há instruções finais para a resposta."],
        ["Condicional", "Resultados confiáveis das tools", "Incluídos quando uma ou mais tools foram executadas."],
        ["Variável", "Contexto da conversa", "Mensagens recentes da conversa, incluindo Evidence associada quando existir."],
      ];

  return (
    <section className="mt-4 rounded-2xl border border-slate-200/80 bg-white/45 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-800">Estrutura prevista · ordem de montagem</p>
        <p className="text-[10px] text-slate-500">A sequência real aparece numerada abaixo.</p>
      </div>
      <ol className="mt-3 grid gap-2 md:grid-cols-2">
        {entries.map(([kind, label, description], index) => (
          <li className="flex items-start gap-2 rounded-xl border border-white/80 bg-white/65 p-3" key={label}>
            <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-md bg-slate-100 font-mono text-[9px] font-semibold text-slate-500">{index + 1}</span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-semibold text-slate-700">{label}</span>
                <span className={`rounded px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.08em] ${kind === "Fixo" ? "bg-indigo-50 text-indigo-700" : kind === "Condicional" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{kind}</span>
              </div>
              <p className="mt-1 text-[10px] leading-4 text-slate-500">{description}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function promptMessageLabel(target: "orchestrator" | "luna", index: number, content: string): string {
  if (target === "orchestrator") {
    return ["Instruções e regras", "Ferramentas registradas", "Estado operacional"][index] ?? "Contexto recente";
  }
  if (index === 0) return "Instruções base";
  if (index === 1) return "Data/hora da iteração";
  if (content.startsWith("Operational response guidance from the Orchestrator:")) return "Orientação do Orchestrator · condicional";
  if (content.startsWith("Trusted tool results for this iteration:")) return "Resultado de tools · condicional";
  return "Contexto da conversa";
}

function promptTargetForTrace(trace: ConversationInspector["responses"][number]): "orchestrator" | "luna" | undefined {
  if (trace.context.promptTarget === "orchestrator" || trace.context.promptTarget === "luna") {
    return trace.context.promptTarget;
  }
  if (trace.kind !== "llm") return undefined;
  if (typeof trace.stages.orchestratorDecision === "number") return "orchestrator";
  if (typeof trace.stages.luna === "number") return "luna";
  return undefined;
}

function ContextDetails({ context }: { context: ConversationInspector["responses"][number]["context"] }) {
  const evidence = isRecord(context.evidence) ? context.evidence : undefined;
  const parts = [
    { key: "immediate", label: "Contexto imediato", part: context.immediate },
    { key: "memory", label: "Memórias recuperadas", part: context.memory },
    { key: "tools", label: "Tools usadas", part: context.tools },
    { key: "system", label: "Sistema da Luna", part: context.system },
    { key: "orchestrator", label: "Instruções do Orchestrator", part: context.orchestrator },
  ];

  return (
    <div className="mt-4 space-y-2">
      <p className="px-1 text-[11px] leading-5 text-slate-500">
        O sistema mostra as mensagens de sistema que foram enviadas à Luna. As instruções do Orchestrator e os resultados das tools ficam separados para não confundir orientação interna com resposta final.
      </p>
      {evidence ? <EvidencePersistenceDetails evidence={evidence} /> : null}
      {parts.filter((entry) => entry.part && ((entry.part.messages?.length ?? 0) > 0 || (entry.part.items?.length ?? 0) > 0)).map((entry) => (
        <details className="group rounded-2xl border border-white/80 bg-white/35" key={entry.key} open={entry.key === "tools"}>
          <summary className="cursor-pointer list-none px-4 py-3 text-xs font-semibold text-slate-700"><span className="mr-2 text-slate-400 group-open:rotate-90">›</span>{entry.label} <span className="ml-1 text-[10px] font-normal text-slate-400">{formatTokens(entry.part?.tokens ?? 0)}</span></summary>
          {entry.key === "tools" ? <div className="border-t border-white/70 px-4 py-3 text-xs text-slate-600"><TraceMessages messages={entry.part?.messages ?? []} />{entry.part?.items?.map((item, index) => isToolTrace(item) ? <ToolTraceDetails item={item} key={index} /> : <ContextItem item={item} key={index} />)}</div> : <div className="border-t border-white/70 px-4 py-3 text-xs text-slate-600"><TraceMessages messages={entry.part?.messages ?? []} />{entry.part?.items?.map((item, index) => <ContextItem item={item} key={index} />)}</div>}
        </details>
      ))}
    </div>
  );
}

function TraceMessages({ messages }: { messages: NonNullable<ContextPart["messages"]> }) {
  return messages.map((message) => (
    <div className="border-b border-slate-200/60 py-2 last:border-0" key={message.id ?? `${message.role}-${message.content.slice(0, 12)}`}>
      <p><span className="font-semibold text-slate-700">{message.role}:</span> {message.content}</p>
      {message.evidence?.map((evidence) => (
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg border border-amber-100 bg-amber-50/60 p-2 text-[10px] leading-4 text-amber-900" key={evidence.evidence_id}>
          Evidence: {JSON.stringify(evidence, null, 2)}
        </pre>
      ))}
    </div>
  ));
}

function ContextItem({ item }: { item: unknown }) {
  if (isRecord(item) && typeof item.content === "string") {
    return (
      <div className="border-b border-slate-200/60 py-2 last:border-0">
        {typeof item.label === "string" ? <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{item.label}</p> : null}
        <pre className="overflow-x-auto whitespace-pre-wrap text-[11px] leading-5 text-slate-600">{item.content}</pre>
      </div>
    );
  }

  return <pre className="overflow-x-auto whitespace-pre-wrap border-b border-slate-200/60 py-2 text-[11px] last:border-0">{JSON.stringify(item, null, 2)}</pre>;
}

const retrievalPhaseLabels: Array<[string, string]> = [
  ["filtered", "Busca por filtros"],
  ["vector", "Busca vetorial · pgvector"],
  ["lexical", "Busca lexical · PostgreSQL FTS"],
  ["fusion", "Fusão de rankings · RRF"],
  ["candidate_pool", "Pool de candidatos"],
  ["reranker_input", "Entrada do cross-encoder"],
  ["reranker", "Cross-encoder · scores e ranking"],
  ["relevance_filter", "Filtro de relevância"],
  ["deduplication", "Deduplicação"],
  ["final", "Compilação · resultado final"],
];

function isToolTrace(item: unknown): item is Record<string, unknown> {
  return isRecord(item) && (typeof item.name === "string" || "retrieval" in item);
}

function ToolTraceDetails({ item }: { item: Record<string, unknown> }) {
  const input = isRecord(item.input) ? item.input : undefined;
  const result = isRecord(item.result) ? item.result : undefined;
  const retrieval = isRecord(item.retrieval) ? item.retrieval : undefined;
  const conversationRetrieval = isRecord(item.conversationRetrieval) ? item.conversationRetrieval : undefined;
  const evidenceResolve = isRecord(item.evidenceResolve) ? item.evidenceResolve : undefined;
  const results = result && Array.isArray(result.results) ? result.results : [];
  const query = input?.query ?? retrieval?.query;

  return (
    <article className="mb-3 rounded-xl border border-violet-200/80 bg-white/65 p-3 last:mb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-slate-800">Execução de tool · {String(item.name ?? "conversation_retrieval")}</p>
          <p className="mt-1 text-[10px] text-slate-500">{query ? `Query: ${String(query)}` : "Execução sem query semântica"} · {results.length || Number(item.resultCount ?? 0)} resultado(s)</p>
        </div>
        <span className={`rounded-lg px-2 py-1 text-[10px] font-semibold ${item.status === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{String(item.status ?? "trace")}</span>
      </div>

      {(!retrieval || !isRecord(retrieval.stageResults)) && item.name === "conversation_retrieval" ? <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] leading-5 text-amber-800">Trace anterior ao detalhamento por fase: a entrada e o payload completo não foram persistidos naquela execução, então não podem ser reconstruídos retroativamente. As próximas execuções gravam cada etapa e a resposta da tool.</p> : null}

      {retrieval ? <RetrievalRunDetails diagnostics={retrieval} /> : null}
      {conversationRetrieval ? <ConversationRetrievalDetails diagnostics={conversationRetrieval} /> : null}
      {evidenceResolve ? <EvidenceResolutionDetails diagnostics={evidenceResolve} /> : null}
      {item.error ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{String(item.error)}</p> : null}

      <details className="mt-3 rounded-lg border border-slate-200/80 bg-white/70" open>
        <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold text-slate-700">Entrada enviada à tool</summary>
        <JsonBlock value={item.input} />
      </details>

      {result ? <ToolResultView result={result} /> : null}
    </article>
  );
}

function EvidencePersistenceDetails({ evidence }: { evidence: Record<string, unknown> }) {
  const records = Array.isArray(evidence.evidences) ? evidence.evidences.filter(isRecord) : [];
  return (
    <section className="rounded-xl border border-amber-200/80 bg-amber-50/55 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-slate-800">Conversation Evidence · persistência</h3>
        <span className={`rounded-lg px-2 py-1 text-[10px] font-semibold ${evidence.enabled === true ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
          {evidence.enabled === true ? "Ativo" : "Desativado"} · {evidence.created === true ? "criada nesta resposta" : "nenhuma criada"}
        </span>
      </div>
      {records.length ? (
        <div className="mt-2 space-y-2">
          {records.map((record, index) => (
            <div className="grid gap-2 rounded-lg border border-white/90 bg-white/70 p-2 text-[10px] sm:grid-cols-4" key={`${String(record.evidenceId ?? "evidence")}-${index}`}>
              <SmallStat label="Evidence ID" value={String(record.evidenceId ?? "—")} />
              <SmallStat label="Referências" value={String(record.referenceCount ?? 0)} />
              <SmallStat label="Data inicial" value={String(record.dateFrom ?? "—")} />
              <SmallStat label="Data final" value={String(record.dateTo ?? "—")} />
              <SmallStat label="Dias de fonte" value={Array.isArray(record.dates) ? record.dates.join(", ") : "—"} />
            </div>
          ))}
        </div>
      ) : null}
      {records.some((record) => Array.isArray(record.sourceReferences)) ? (
        <details className="mt-2 rounded-lg border border-amber-100 bg-white/70">
          <summary className="cursor-pointer px-3 py-2 text-[10px] font-semibold text-slate-600">Referências internas persistidas</summary>
          <JsonBlock value={records.map(({ evidenceId, sourceReferences }) => ({ evidenceId, sourceReferences }))} />
        </details>
      ) : null}
    </section>
  );
}

function EvidenceResolutionDetails({ diagnostics }: { diagnostics: Record<string, unknown> }) {
  return (
    <section className="mt-3 rounded-xl border border-amber-200/80 bg-amber-50/55 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-slate-800">Evidence · resolução e expansão</h3>
        <span className="text-[10px] text-slate-500">{formatDuration(Number(diagnostics.latencyMs ?? 0))}</span>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <SmallStat label="Evidence ID" value={String(diagnostics.evidenceId ?? "—")} />
        <SmallStat label="Direção" value={String(diagnostics.direction ?? "—")} />
        <SmallStat label="Referências" value={String(diagnostics.referenceCount ?? 0)} />
        <SmallStat label="Mensagens devolvidas" value={String(diagnostics.resultCount ?? 0)} />
      </div>
    </section>
  );
}

function ConversationRetrievalDetails({ diagnostics }: { diagnostics: Record<string, unknown> }) {
  const stages = isRecord(diagnostics.stages) ? diagnostics.stages : {};
  const counts = isRecord(diagnostics.counts) ? diagnostics.counts : {};
  const candidates = Array.isArray(diagnostics.candidates) ? diagnostics.candidates.filter(isRecord) : [];
  const reasonLabels: Record<string, string> = {
    outside_current_message_visibility: "fora do limite da mensagem atual",
    source_message_missing: "mensagem de origem não encontrada",
    no_message_in_date_range: "nenhuma mensagem dentro das datas",
    context_budget: "orçamento de contexto esgotado",
  };
  return (
    <section className="mt-3 rounded-xl border border-cyan-200/80 bg-cyan-50/45 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-slate-800">Pós-processamento da conversation_retrieval</h3>
        <span className="text-[10px] text-slate-500">{Number(counts.returnedResults ?? 0)} resultado(s) montado(s) · {Number(counts.excludedCandidates ?? 0)} candidato(s) descartado(s)</span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <SmallStat label="Scope" value={String(diagnostics.scope ?? "—")} />
        <SmallStat label="Janela temporal" value={`${String(diagnostics.dateFrom ?? "sem início")} → ${String(diagnostics.dateTo ?? "sem fim")}`} />
        <SmallStat label="Orçamento" value={`${String(diagnostics.maxContextTokens ?? "—")} tokens`} />
        <SmallStat label="Mensagens no payload" value={diagnostics.includeMessages === true ? "sim" : "não"} />
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {([ ["messageExpansion", "Expansão das mensagens de origem"], ["resultAssembly", "Montagem e orçamento do resultado"] ] as const).map(([key, label]) => {
          const stage = isRecord(stages[key]) ? stages[key] : {};
          return <div className="rounded-lg border border-white/90 bg-white/70 px-3 py-2 text-[10px]" key={key}><span className="font-semibold text-slate-700">{label}</span><span className="float-right text-slate-500">{Number(stage.count ?? 0)} candidato(s) · {formatDuration(Number(stage.latencyMs ?? 0))}</span></div>;
        })}
      </div>
      <div className="mt-3 max-h-64 overflow-auto rounded-lg border border-cyan-100 bg-white/70">
        <table className="min-w-[760px] w-full border-collapse text-left text-[10px]">
          <thead className="sticky top-0 bg-cyan-50 text-slate-500"><tr>{["Chunk", "Decisão", "Mensagens na janela", "Mensagens retornadas", "Tokens retornados"].map((label) => <th className="px-2 py-2 font-semibold" key={label}>{label}</th>)}</tr></thead>
          <tbody>{candidates.map((candidate, index) => {
            const reason = typeof candidate.reason === "string" ? reasonLabels[candidate.reason] ?? candidate.reason : "";
            return <tr className="border-t border-slate-100" key={`${String(candidate.chunkId ?? "chunk")}-${index}`}>
              <td className="break-all px-2 py-2 font-mono text-slate-600">{String(candidate.chunkId ?? "—")}</td>
              <td className="px-2 py-2 text-slate-600">{candidate.outcome === "returned" ? "retornado" : `descartado · ${reason || "sem motivo registrado"}`}</td>
              <td className="px-2 py-2 text-slate-600">{String(candidate.sourceMessageCount ?? 0)}</td>
              <td className="px-2 py-2 text-slate-600">{String(candidate.returnedMessageCount ?? 0)}</td>
              <td className="px-2 py-2 text-slate-600">{String(candidate.resultTokens ?? "—")}</td>
            </tr>;
          })}</tbody>
        </table>
        {!candidates.length ? <p className="px-3 py-2 text-[10px] text-slate-400">Nenhum candidato passou pelo pós-processamento.</p> : null}
      </div>
      <details className="mt-2 rounded-lg border border-cyan-100 bg-white/70"><summary className="cursor-pointer px-3 py-2 text-[10px] font-semibold text-slate-600">Diagnóstico bruto do pós-processamento</summary><JsonBlock value={diagnostics} /></details>
    </section>
  );
}

function RetrievalRunDetails({ diagnostics }: { diagnostics: Record<string, unknown> }) {
  const stages = isRecord(diagnostics.stages) ? diagnostics.stages : {};
  const stageResults = isRecord(diagnostics.stageResults) ? diagnostics.stageResults : {};
  const ledger = Array.isArray(diagnostics.candidates) ? diagnostics.candidates.filter(isRecord) : [];
  const config = isRecord(diagnostics.config) ? diagnostics.config : {};
  const reranker = isRecord(diagnostics.reranker) ? diagnostics.reranker : {};

  return (
    <section className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/45 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-slate-800">Retrieval · execução por fase</h3>
        <span className="text-[10px] font-medium text-slate-500">{formatDuration(Number(diagnostics.totalLatencyMs ?? 0))} total · {Number(diagnostics.finalResultCount ?? 0)} final(is)</span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <SmallStat label="Query" value={diagnostics.query == null ? "null · filtros" : String(diagnostics.query)} />
        <SmallStat label="Estratégia" value={String(config.strategy ?? "—")} />
        <SmallStat label="Reranker" value={reranker.model == null ? "desativado / sem query" : String(reranker.model)} />
        <SmallStat label="Threshold ativo" value={reranker.threshold == null ? "não aplicado" : String(reranker.threshold)} />
      </div>

      <div className="mt-4 space-y-2">
        {retrievalPhaseLabels.map(([key, label]) => {
          const stage = isRecord(stages[key]) ? stages[key] : undefined;
          const candidates = Array.isArray(stageResults[key]) ? stageResults[key].filter(isRecord) : [];
          const reason = skippedPhaseReason(key, diagnostics, config);
          const executed = Boolean(stage) && !reason;
          const count = typeof stage?.count === "number" ? stage.count : candidates.length;
          const duration = typeof stage?.latencyMs === "number" ? formatDuration(stage.latencyMs) : "—";
          const effectiveLabel = key === "fusion" && config.strategy !== "hybrid" ? "Seleção do ranking" : key === "relevance_filter" && reranker.model == null ? "Filtro de relevância · pass-through" : label;
          return (
            <details className="rounded-lg border border-white/90 bg-white/70" key={key} open={key === "final"}>
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-[11px]">
                <span className="font-semibold text-slate-700">{effectiveLabel}</span>
                <span className="text-slate-500">{executed ? `${count} candidato(s) · ${duration}` : reason ?? "não executada"}</span>
              </summary>
              <div className="border-t border-slate-100 px-3 py-3">
                {candidates.length ? <RetrievalCandidateTable candidates={candidates} /> : <p className="text-[10px] text-slate-400">{executed ? "Nenhum candidato nesta fase." : reason ?? "Fase não executada nesta chamada."}</p>}
              </div>
            </details>
          );
        })}
      </div>

      <details className="mt-3 rounded-lg border border-indigo-100 bg-white/70">
        <summary className="cursor-pointer px-3 py-2.5 text-[11px] font-semibold text-slate-700">Rastreamento completo de candidatos · {ledger.length} item(ns)</summary>
        <div className="border-t border-slate-100 px-3 py-3">{ledger.length ? <RetrievalCandidateTable candidates={ledger} showDecision /> : <p className="text-[10px] text-slate-400">Não há candidatos registrados.</p>}</div>
      </details>
      <details className="mt-2 rounded-lg border border-indigo-100 bg-white/70">
        <summary className="cursor-pointer px-3 py-2.5 text-[11px] font-semibold text-slate-700">Filtros, configuração e diagnóstico bruto</summary>
        <JsonBlock value={{ filters: diagnostics.filters, config: diagnostics.config, counts: diagnostics.counts, reranker: diagnostics.reranker, fallback: diagnostics.fallback }} />
      </details>
    </section>
  );
}

function skippedPhaseReason(key: string, diagnostics: Record<string, unknown>, config: Record<string, unknown>): string {
  if (key === "vector" && config.strategy === "lexical-only") return "pulada · estratégia lexical-only";
  if (key === "lexical" && config.strategy === "vector-only") return "pulada · estratégia vector-only";
  if (["vector", "lexical", "reranker", "reranker_input"].includes(key) && diagnostics.query == null) return "pulada · query semântica null";
  if (["reranker", "reranker_input"].includes(key) && config.rerankerEnabled !== true) return "pulada · reranker desativado";
  if (["reranker", "reranker_input"].includes(key) && config.rerankerEnabled === true) return "pulada · pool sem candidatos";
  return "não executada";
}

function RetrievalCandidateTable({ candidates, showDecision = false }: { candidates: Record<string, unknown>[]; showDecision?: boolean }) {
  return (
    <div className="max-h-[26rem] overflow-auto rounded-lg border border-slate-200/80">
      <table className="min-w-[1120px] w-full border-collapse text-left text-[10px]">
        <thead className="sticky top-0 bg-slate-100 text-slate-500"><tr>{["ID", "Origem", "Apareceu em", "Vetor · rank/score", "Lexical · rank/score", "RRF", "Reranker", ...(showDecision ? ["Decisão final"] : []), "Trecho avaliado", "Metadados"].map((label) => <th className="px-2 py-2 font-semibold" key={label}>{label}</th>)}</tr></thead>
        <tbody>{candidates.map((candidate, index) => {
          const appearedIn = Array.isArray(candidate.appearedIn) ? candidate.appearedIn.join(", ") : "—";
          const vector = `${candidate.vectorRank ?? "—"} / ${formatScore(candidate.vectorScore)}`;
          const lexical = `${candidate.lexicalRank ?? "—"} / ${formatScore(candidate.lexicalScore)}`;
          const decision = candidate.finalRank != null ? `#${candidate.finalRank}` : candidate.excludedBy ? `descartado · ${String(candidate.excludedBy)}` : "sem rank final";
          const preview = typeof candidate.contentPreview === "string" ? candidate.contentPreview : "";
          return <tr className="border-t border-slate-100 align-top" key={`${String(candidate.id ?? "candidate")}-${index}`}>
            <td className="max-w-40 break-all px-2 py-2 font-mono text-slate-700">{String(candidate.id ?? "—")}</td>
            <td className="px-2 py-2 text-slate-600">{String(candidate.source ?? "—")}</td>
            <td className="px-2 py-2 text-slate-600">{appearedIn}</td>
            <td className="px-2 py-2 tabular-nums text-slate-600">{vector}</td>
            <td className="px-2 py-2 tabular-nums text-slate-600">{lexical}</td>
            <td className="px-2 py-2 tabular-nums text-slate-600">{formatScore(candidate.rrfScore)}</td>
            <td className="px-2 py-2 tabular-nums text-slate-600">{formatScore(candidate.rerankerScore)}</td>
            {showDecision ? <td className="px-2 py-2 text-slate-600">{decision}</td> : null}
            <td className="max-w-72 px-2 py-2 text-slate-600">{preview ? <details><summary className="max-w-64 cursor-pointer truncate">{preview.slice(0, 100)}{preview.length > 100 ? "…" : ""}</summary><pre className="mt-2 max-h-48 min-w-64 overflow-auto whitespace-pre-wrap">{preview}</pre></details> : "—"}</td>
            <td className="max-w-56 px-2 py-2 font-mono text-slate-500">{candidate.metadata ? JSON.stringify(candidate.metadata) : "—"}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  );
}

function ToolResultView({ result }: { result: Record<string, unknown> }) {
  const results = Array.isArray(result.results) ? result.results.filter(isRecord) : [];
  return (
    <section className="mt-3 rounded-xl border border-emerald-200/80 bg-emerald-50/45 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-xs font-semibold text-slate-800">Resultado devolvido pela tool</h3><span className="text-[10px] text-slate-500">{results.length} resultado(s) · query {result.query == null ? "null" : `“${String(result.query)}”`}</span></div>
      {results.length ? <div className="mt-3 space-y-2">{results.map((entry, index) => <article className="rounded-lg border border-white/90 bg-white/75 p-3" key={String(entry.chunkId ?? index)}>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500"><span className="font-mono">chunk {String(entry.chunkId ?? "—")}</span><span>conversa {String(entry.conversationId ?? "—")}</span><span>posição {index + 1}</span>{isRecord(entry.timeRange) ? <span>{String(entry.timeRange.start ?? "?")} → {String(entry.timeRange.end ?? "?")}</span> : null}</div>
        <pre className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-slate-700">{String(entry.content ?? "")}{entry.tailContent ? `\n${String(entry.tailContent)}` : ""}</pre>
        {Array.isArray(entry.messages) && entry.messages.length ? <details className="mt-2"><summary className="cursor-pointer text-[10px] font-semibold text-slate-500">Mensagens de origem · {entry.messages.length}</summary><JsonBlock value={entry.messages} /></details> : null}
      </article>)}</div> : <p className="mt-3 text-[11px] text-slate-500">A tool retornou zero resultados.</p>}
      <details className="mt-3 rounded-lg border border-emerald-100 bg-white/70"><summary className="cursor-pointer px-3 py-2 text-[10px] font-semibold text-slate-600">Payload completo da resposta</summary><JsonBlock value={result} /></details>
    </section>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="max-h-[24rem] overflow-auto whitespace-pre-wrap break-words border-t border-slate-100 px-3 py-2 font-mono text-[10px] leading-5 text-slate-600">{JSON.stringify(value, null, 2)}</pre>;
}

function formatScore(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(6) : "—";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function contextContributions(context: ConversationInspector["responses"][number]["context"]) {
  return [
    { label: "Contexto imediato", tokens: context.immediate?.tokens ?? 0, tone: "bg-indigo-400/80" },
    { label: "Memória", tokens: context.memory?.tokens ?? 0, tone: "bg-emerald-400/75" },
    { label: "Tools", tokens: context.tools?.tokens ?? 0, tone: "bg-violet-300/90" },
    { label: "Sistema da Luna", tokens: context.system?.tokens ?? 0, tone: "bg-slate-400/75" },
    { label: "Orchestrator", tokens: context.orchestrator?.tokens ?? 0, tone: "bg-amber-300/90" },
  ];
}

function ContextContribution({ part, max }: { part: { label: string; tokens: number; tone: string }; max: number }) {
  return <div><div className="mb-1.5 flex items-center justify-between gap-3 text-[11px] text-slate-500"><span>{part.label}</span><span className="font-semibold text-slate-700">{formatTokens(part.tokens)}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-200/70"><div className={`h-full rounded-full ${part.tone}`} style={{ width: `${part.tokens ? Math.max(4, (part.tokens / max) * 100) : 0}%` }} /></div></div>;
}

function MetricCard({ icon: Icon, label, value, detail, tone = "default" }: { icon: typeof Activity; label: string; value: string; detail: string; tone?: "default" | "warning" }) {
  return <div className="glass rounded-2xl p-4"><div className="flex items-center justify-between gap-3"><div className={`flex size-9 items-center justify-center rounded-xl ${tone === "warning" ? "bg-amber-50 text-amber-600" : "bg-indigo-50 text-indigo-600"}`}><Icon className="size-4" /></div><span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</span></div><p className="mt-4 text-2xl font-semibold tracking-tight text-slate-950">{value}</p><p className="mt-1 text-[11px] text-slate-500">{detail}</p></div>;
}

function SectionHeading({ icon: Icon, eyebrow, title, description }: { icon: typeof Activity; eyebrow: string; title: string; description: string }) {
  return <div className="flex min-w-0 items-start gap-3"><div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><Icon className="size-4" /></div><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-indigo-600">{eyebrow}</p><h2 className="mt-1 text-base font-semibold text-slate-950">{title}</h2><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p></div></div>;
}

function SmallStat({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-white/75 bg-white/45 px-3 py-2"><p className="truncate text-[10px] text-slate-500">{label}</p><p className="mt-1 truncate text-xs font-semibold text-slate-800">{value}</p></div>; }
function TraceStatus({ status }: { status: string }) { return status === "success" ? <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" /> : status === "timeout" ? <Clock3 className="size-3.5 shrink-0 text-amber-500" /> : <XCircle className="size-3.5 shrink-0 text-red-500" />; }
function EmptyChart() { return <div className="flex w-full items-center justify-center text-xs text-slate-400">Ainda não há dados neste período.</div>; }
function EmptyInline({ label }: { label: string }) { return <div className="rounded-xl border border-dashed border-white/90 bg-white/25 px-3 py-5 text-center text-[11px] text-slate-500">{label}</div>; }
function dateFromDaysAgo(days: number): string { const date = new Date(); date.setDate(date.getDate() - (days - 1)); date.setHours(0, 0, 0, 0); return date.toISOString(); }
function formatNumber(value: number): string { return new Intl.NumberFormat("pt-BR").format(value); }
function formatTokens(value: number): string { return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : formatNumber(value); }
function formatDuration(value: number): string { return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(1)} s`; }
function formatDateTime(value: string): string { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
function shortDate(value: string): string { return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(new Date(`${value}T12:00:00`)); }
function stageLabel(value: string): string { return value.replace(/([A-Z])/gu, " $1").replace(/^./u, (char) => char.toUpperCase()); }
