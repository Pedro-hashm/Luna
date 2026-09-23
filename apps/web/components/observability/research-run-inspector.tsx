"use client";

import { useMemo } from "react";
import { CheckCircle2, Clock3, ExternalLink, FileText, Globe2, Search, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import type { ResearchEvent, ResearchRunView, ResearchSource } from "@/lib/conversation-api";

const eventLabels: Record<string, string> = {
  "research.started": "Pesquisa iniciada",
  "research.planner.started": "Planner iniciado",
  "research.planner.completed": "Plano concluído",
  "research.planner.failed": "Planner falhou",
  "research.round.started": "Rodada iniciada",
  "research.round.completed": "Rodada concluída",
  "research.search.started": "Busca iniciada",
  "research.search.completed": "Busca concluída",
  "research.search.failed": "Busca falhou",
  "research.source.selected": "Fonte selecionada",
  "research.source.rejected": "Fonte descartada",
  "research.extract.started": "Extração iniciada",
  "research.extract.completed": "Extração concluída",
  "research.extract.failed": "Extração falhou",
  "research.evidence.created": "Evidência criada",
  "research.verification.started": "Verificação iniciada",
  "research.verification.completed": "Verificação concluída",
  "research.completed": "Pesquisa concluída",
  "research.failed": "Pesquisa falhou",
};

export function ResearchRunInspector({ run }: { run: ResearchRunView }) {
  const metadata = asRecord(run.metadata);
  const events = useMemo(() => [...run.events].sort((a, b) => a.sequence - b.sequence), [run.events]);
  const planner = [...events].reverse().find((event) => event.type === "research.planner.completed");
  const plannerData = asRecord(planner?.data);
  const plan = asRecord(plannerData.plan);
  const queries = recordArray(plan.queries).length ? recordArray(plan.queries) : recordArray(plannerData.queries);
  const searchEvents = events.filter((event) => event.type === "research.search.completed" || event.type === "research.search.failed");
  const extractionEvents = events.filter((event) => event.type === "research.extract.completed" || event.type === "research.extract.failed");
  const extractedCount = extractionEvents.filter((event) => event.type === "research.extract.completed").length;
  const browserCount = extractionEvents.filter((event) => {
    const data = asRecord(event.data);
    return data.browserFallback === true || data.fallbackUsed === true || stringValue(data.method || data.extractionMethod).includes("browser");
  }).length;
  const rejectedEvents = events.filter((event) => event.type === "research.source.rejected");
  const verificationEvents = events.filter((event) => event.type === "research.verification.completed");
  const verification = asRecord(verificationEvents.at(-1)?.data);
  const conflicts = arrayValue(verification.conflicts).length ? arrayValue(verification.conflicts) : arrayValue(metadata.conflicts);
  const gaps = arrayValue(verification.gaps);
  const sourceById = new Map(run.sources.map((source) => [source.id, source]));
  const selectedReasons = new Map(events.filter((event) => event.type === "research.source.selected").map((event) => {
    const data = asRecord(event.data);
    return [stringValue(data.sourceId), stringValue(data.reason)] as const;
  }));
  const latencyMs = numberValue(metadata.latencyMs) ?? (run.completedAt ? Math.max(0, new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) : undefined);
  const plannerTokens = (numberValue(metadata.plannerInputTokens) ?? numberValue(plannerData.inputTokens) ?? 0) +
    (numberValue(metadata.plannerOutputTokens) ?? numberValue(plannerData.outputTokens) ?? 0);
  const decision = stringValue(verification.decision || verification.status || metadata.verification || metadata.decision);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-indigo-100 bg-indigo-50/45 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-indigo-600">Research run · {run.id}</p>
            <h3 className="mt-2 text-base font-semibold text-slate-900">{run.question}</h3>
            <p className="mt-1 text-[11px] text-slate-500">{formatDateTime(run.startedAt)} · {run.messageId ? `mensagem ${run.messageId}` : "sem mensagem vinculada"}</p>
          </div>
          <StatusBadge status={run.status} />
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Planner combo" value={run.plannerCombo || "—"} />
          <Stat label="Modo / rodadas" value={`${run.mode || "—"} / ${displayNumber(metadata.rounds, events.filter((event) => event.type === "research.round.started").length)}`} />
          <Stat label="Busca / fontes" value={`${displayNumber(metadata.searchQueries, searchEvents.length)} query(s) / ${run.sources.length} fonte(s)`} />
          <Stat label="Evidências / conflitos" value={`${run.evidence.length} / ${conflicts.length}`} />
          <Stat label="Latência" value={latencyMs === undefined ? "Em andamento" : formatDuration(latencyMs)} />
          <Stat label="Chamadas do planner" value={displayNumber(metadata.llmCalls, events.filter((event) => event.type === "research.planner.started").length)} />
          <Stat label="Tokens do planner" value={plannerTokens ? formatNumber(plannerTokens) : "Não informado"} />
          <Stat label="Decisão" value={decision || (run.status === "completed" ? "Concluída" : "—")} />
        </div>
      </section>

      <Section icon={Sparkles} title="Planejamento" detail="Combo, intenção e consultas do Search Planner">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Combo" value={stringValue(plannerData.combo) || run.plannerCombo || "—"} />
          <Stat label="Modelo" value={stringValue(plannerData.model) || "Não informado"} />
          <Stat label="Intenção" value={stringValue(plan.intent || plannerData.intention || plannerData.intent || plan.action) || "Não informada"} />
          <Stat label="Queries" value={String(queries.length || searchEvents.length)} />
        </div>
        {queries.length ? (
          <div className="mt-3 space-y-2">
            {queries.map((item, index) => <div className="rounded-xl border border-white/90 bg-white/70 p-3" key={`${stringValue(item.query)}-${index}`}>
              <p className="text-xs font-semibold text-slate-800">{index + 1}. {stringValue(item.query) || "Query sem texto"}</p>
              <p className="mt-1 text-[11px] text-slate-500">{stringValue(item.purpose || item.reason) || "Objetivo não registrado"}</p>
            </div>)}
          </div>
        ) : <Empty label="O plano estruturado ainda não foi registrado." />}
        {plannerData.prompt || plannerData.promptMessages || plannerData.messages ? <RawDetails label="Prompt recebido pelo planner" value={plannerData.promptMessages ?? plannerData.messages ?? plannerData.prompt} /> : <p className="mt-3 text-[10px] text-slate-500">Prompt do planner não registrado nesta execução.</p>}
        {planner ? <RawDetails label="Decisão estruturada completa" value={plannerData} /> : null}
      </Section>

      <Section icon={Search} title="Busca e rodadas" detail="Provider, consultas, resultados e seleção">
        {searchEvents.length ? <div className="space-y-2">{searchEvents.map((event) => {
          const data = asRecord(event.data);
          return <div className="rounded-xl border border-white/90 bg-white/70 p-3" key={event.id}>
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-800">{stringValue(data.query) || "Busca"}</p><span className={`text-[10px] ${event.type === "research.search.failed" ? "font-semibold text-red-700" : "text-slate-500"}`}>{event.type === "research.search.failed" ? "Falhou · " : ""}Rodada {stringValue(data.round) || "—"} · {formatOptionalDuration(data.latencyMs ?? data.durationMs)}</span></div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600"><span>Provider: <b>{stringValue(data.provider) || "—"}</b></span><span>Resultados: <b>{displayNumber(data.resultCount ?? data.results, 0)}</b></span><span>Selecionados: <b>{displayNumber(data.selectedCount ?? data.selected, 0)}</b></span><span>Descartados: <b>{displayNumber(data.rejectedCount ?? data.rejected, 0)}</b></span></div>
            {event.type === "research.search.failed" ? <p className="mt-2 text-[11px] text-red-700">{stringValue(data.error || data.reason) || "Falha sem detalhe registrado"}</p> : null}
            <RawDetails label="Metadados desta busca" value={data} />
          </div>;
        })}</div> : <Empty label="Nenhuma busca concluída registrada." />}
      </Section>

      <Section icon={Globe2} title="Fontes" detail="Origem, ranking, datas e motivo da seleção">
        {run.sources.length ? <div className="space-y-2">{run.sources.map((source) => <SourceCard key={source.id} source={source} reason={selectedReasons.get(source.id)} />)}</div> : <Empty label="Nenhuma fonte selecionada nesta execução." />}
        {rejectedEvents.length ? <details className="mt-3 rounded-xl border border-white/90 bg-white/70"><summary className="cursor-pointer px-3 py-2.5 text-[11px] font-semibold text-slate-700">Resultados descartados · {rejectedEvents.length}</summary><div className="space-y-2 border-t border-slate-100 p-3">{rejectedEvents.map((event) => <div className="rounded-lg bg-slate-50 px-3 py-2 text-[10px] text-slate-600" key={event.id}><p>{stringValue(event.data.title || event.data.url || event.data.sourceId) || "Resultado"} · {stringValue(event.data.reason) || "Motivo não registrado"}</p><RawDetails label="Dados do descarte" value={event.data} /></div>)}</div></details> : null}
      </Section>

      <Section icon={FileText} title="Extração" detail="Método, fallback, conteúdo e falhas por fonte">
        <div className="mb-3 grid gap-2 sm:grid-cols-3"><Stat label="Sucesso" value={`${extractedCount} / ${extractionEvents.length}`} /><Stat label="Static" value={String(Math.max(0, extractedCount - browserCount))} /><Stat label="Browser fallback" value={String(browserCount)} /></div>
        {extractionEvents.length ? <div className="space-y-2">{extractionEvents.map((event) => {
          const data = asRecord(event.data);
          const source = sourceById.get(stringValue(data.sourceId));
          const failed = event.type === "research.extract.failed";
          return <div className={`rounded-xl border p-3 ${failed ? "border-red-200 bg-red-50/65" : "border-white/90 bg-white/70"}`} key={event.id}>
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-800">{source?.title || stringValue(data.url || data.sourceId) || "Fonte"}</p><span className={`text-[10px] font-semibold ${failed ? "text-red-700" : "text-emerald-700"}`}>{failed ? "Falhou" : "Sucesso"}</span></div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600"><span>Método: <b>{stringValue(data.method || data.extractionMethod || source?.extractionMethod) || "—"}</b></span><span>Browser fallback: <b>{data.browserFallback === true || data.fallbackUsed === true ? "sim" : "não"}</b></span><span>Conteúdo: <b>{displayNumber(data.contentLength ?? data.contentChars, 0)} caracteres</b></span><span>Tempo: <b>{formatOptionalDuration(data.latencyMs ?? data.durationMs)}</b></span></div>
            {failed ? <p className="mt-2 text-[11px] text-red-700">{stringValue(data.error || data.reason) || "Falha sem detalhe registrado"}</p> : null}
            <RawDetails label="Metadados da extração" value={data} />
          </div>;
        })}</div> : <Empty label="Nenhuma extração concluída registrada." />}
      </Section>

      <Section icon={FileText} title="Evidence" detail="Trechos vinculados a sourceId para a síntese">
        {run.evidence.length ? <div className="space-y-2">{run.evidence.map((item) => {
          const source = sourceById.get(item.sourceId);
          return <article className="rounded-xl border border-white/90 bg-white/70 p-3" key={item.id}><div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500"><span className="font-mono">{item.id} · {item.sourceId}</span><span className="rounded-md bg-indigo-50 px-2 py-1 font-semibold text-indigo-700">{item.type}</span></div><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-800">{item.text}</p><p className="mt-2 text-[10px] text-slate-500">{source?.domain || "Fonte não localizada"}{item.location ? ` · ${item.location}` : ""}</p></article>;
        })}</div> : <Empty label="Nenhuma evidência útil registrada." />}
      </Section>

      <Section icon={ShieldCheck} title="Verificação e síntese" detail="Suficiência, conflitos, lacunas e contexto devolvido à conversa">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Decisão" value={decision || "Não registrada"} /><Stat label="Conflitos" value={String(conflicts.length)} /><Stat label="Lacunas" value={String(gaps.length)} /><Stat label="Nova rodada" value={verification.newRound === true ? "solicitada" : "não"} /></div>
        {conflicts.length ? <RawDetails label="Fontes conflitantes" value={conflicts} open /> : null}
        {gaps.length ? <RawDetails label="Lacunas identificadas" value={gaps} open /> : null}
        {verificationEvents.length ? <RawDetails label="Verificação completa" value={verification} /> : null}
        {run.summaryContext ? <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/50 p-3"><p className="text-[11px] font-semibold text-emerald-800">Contexto entregue ao LLM de resposta</p><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-700">{run.summaryContext}</p></div> : null}
        {run.status === "failed" ? <p className="mt-3 rounded-xl border border-red-200 bg-red-50/70 p-3 text-xs text-red-700">{stringValue(metadata.error || events.find((event) => event.type === "research.failed")?.data.error) || "A pesquisa falhou sem detalhe registrado."}</p> : null}
      </Section>

      <Section icon={Clock3} title="Linha do tempo" detail={`${events.length} evento(s), na ordem em que ocorreram`}>
        {events.length ? <ol className="space-y-2">{events.map((event) => <EventRow event={event} key={event.id} />)}</ol> : <Empty label="Ainda não há eventos de execução." />}
        {arrayValue(metadata.errors).length ? <RawDetails label={`Erros da execução · ${arrayValue(metadata.errors).length}`} value={metadata.errors} open /> : null}
        <RawDetails label="Metadados completos da execução" value={run.metadata} />
      </Section>
    </div>
  );
}

function SourceCard({ source, reason }: { source: ResearchSource; reason?: string }) {
  const href = safeHttpUrl(source.url);
  return <article className="rounded-xl border border-white/90 bg-white/70 p-3">
    <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="text-xs font-semibold text-slate-800">{source.title || source.domain}</p><p className="mt-1 text-[10px] text-slate-500">{source.domain} · {source.sourceType || "tipo não informado"} · rank {source.rank ?? "—"}</p></div>{href ? <a className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-700 hover:underline" href={href} rel="noopener noreferrer" target="_blank">Abrir fonte <ExternalLink className="size-3" /></a> : null}</div>
    <p className="mt-2 break-all font-mono text-[10px] text-slate-500">{source.url}</p>
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500"><span>Publicada: {source.publishedAt ? formatDateTime(source.publishedAt) : "—"}</span><span>Coletada: {formatDateTime(source.retrievedAt)}</span><span>Extração: {source.extractionMethod || "—"}</span></div>
    {reason ? <p className="mt-2 text-[10px] text-slate-600">Selecionada: {reason}</p> : null}
    {Object.keys(asRecord(source.metadata)).length ? <RawDetails label="Metadados da fonte" value={source.metadata} /> : null}
  </article>;
}

function EventRow({ event }: { event: ResearchEvent }) {
  const isError = event.type.endsWith("failed");
  const isComplete = event.type.endsWith("completed") || event.type.endsWith("created") || event.type.endsWith("selected");
  return <li className="flex gap-3 rounded-xl border border-white/90 bg-white/70 p-3">
    <div className="pt-0.5">{isError ? <TriangleAlert className="size-3.5 text-red-500" /> : isComplete ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : <Clock3 className="size-3.5 text-indigo-500" />}</div>
    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[11px] font-semibold text-slate-800">{eventLabels[event.type] || event.type}</p><span className="text-[10px] text-slate-500">#{event.sequence} · {formatDateTime(event.createdAt)}</span></div><p className="mt-1 font-mono text-[10px] text-slate-400">{event.type}</p><RawDetails label="Dados do evento" value={event.data} /></div>
  </li>;
}

function Section({ icon: Icon, title, detail, children }: { icon: typeof Search; title: string; detail: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-white/85 bg-white/42 p-4 sm:p-5"><div className="mb-3 flex items-start gap-3"><div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><Icon className="size-4" /></div><div><h3 className="text-sm font-semibold text-slate-900">{title}</h3><p className="mt-0.5 text-[11px] text-slate-500">{detail}</p></div></div>{children}</section>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-xl border border-white/85 bg-white/70 px-3 py-2"><p className="text-[10px] text-slate-500">{label}</p><p className="mt-1 break-words text-xs font-semibold text-slate-800" title={value}>{value}</p></div>;
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === "completed" ? "bg-emerald-50 text-emerald-700" : status === "failed" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700";
  const label = { completed: "Concluída", failed: "Falhou", insufficient: "Insuficiente", running: "Em andamento" }[status] ?? status;
  return <span className={`rounded-lg px-2.5 py-1.5 text-[10px] font-semibold ${tone}`}>{label}</span>;
}

function Empty({ label }: { label: string }) { return <p className="rounded-xl border border-dashed border-slate-200 bg-white/40 px-3 py-4 text-[11px] text-slate-500">{label}</p>; }
function RawDetails({ label, value, open = false }: { label: string; value: unknown; open?: boolean }) { return <details className="mt-2 rounded-lg border border-slate-100 bg-white/65" open={open}><summary className="cursor-pointer px-3 py-2 text-[10px] font-semibold text-slate-600">{label}</summary><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-slate-100 px-3 py-2 font-mono text-[10px] leading-5 text-slate-600">{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre></details>; }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function recordArray(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => item && typeof item === "object" && !Array.isArray(item)) : []; }
function arrayValue(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function stringValue(value: unknown): string { return typeof value === "string" ? value : typeof value === "number" ? String(value) : ""; }
function numberValue(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function displayNumber(value: unknown, fallback: number): string { return formatNumber(numberValue(value) ?? fallback); }
function formatNumber(value: number): string { return new Intl.NumberFormat("pt-BR").format(value); }
function formatDuration(value: number): string { return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(1)} s`; }
function formatOptionalDuration(value: unknown): string { const number = numberValue(value); return number === undefined ? "—" : formatDuration(number); }
function formatDateTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" }).format(date); }
function safeHttpUrl(value: string): string | undefined { try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined; } catch { return undefined; } }
