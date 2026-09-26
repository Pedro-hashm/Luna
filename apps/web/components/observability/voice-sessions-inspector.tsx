"use client";

import { Activity, LoaderCircle, RefreshCw, Volume2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getConversation, getConversationResearchRuns, type ConversationMessage, type ResearchRunView } from "@/lib/conversation-api";
import { getVoiceSessionEvents, getVoiceSessions, type VoiceEvent, type VoiceSession } from "@/lib/voice-api";

export function VoiceSessionsInspector({ conversationId }: { conversationId: string }) {
  const [sessions, setSessions] = useState<VoiceSession[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [events, setEvents] = useState<VoiceEvent[]>([]);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [researchRuns, setResearchRuns] = useState<ResearchRunView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    void getVoiceSessions(conversationId).then((next) => {
      if (!active) return;
      setSessions(next);
      setSelectedId((current) => next.some((session) => session.id === current) ? current : next[0]?.id);
      setError(undefined);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Não foi possível carregar as sessões de voz.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [conversationId, refresh]);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    void getVoiceSessionEvents(selectedId).then((result) => {
      if (active) { setEvents(result.events); setError(undefined); }
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Não foi possível carregar os eventos da sessão.");
    });
    return () => { active = false; };
  }, [selectedId, refresh]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getConversation(conversationId),
      getConversationResearchRuns(conversationId).catch(() => ({ runs: [] as ResearchRunView[] })),
    ]).then(([conversation, research]) => {
      if (!active) return;
      setMessages(conversation.messages);
      setResearchRuns(research.runs);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [conversationId, refresh]);

  const selected = sessions.find((session) => session.id === selectedId);
  const interactions = events.filter((event) => event.type === "voice.thinking.completed").map((event) => {
    const userId = typeof event.data.userMessageId === "string" ? event.data.userMessageId : "";
    const assistantId = typeof event.data.assistantMessageId === "string" ? event.data.assistantMessageId : "";
    return {
      event,
      user: messages.find((message) => message.id === userId),
      assistant: messages.find((message) => message.id === assistantId),
      research: researchRuns.find((run) => run.messageId === userId || run.messageId === assistantId),
    };
  });
  return <section className="mt-6 grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
    <aside className="glass rounded-[1.7rem] p-5 sm:p-6">
      <div className="flex items-center justify-between gap-2"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-indigo-600">Conversation</p><h2 className="mt-1 truncate text-sm font-semibold text-slate-900">{conversationId}</h2></div><button aria-label="Atualizar sessões de voz" className="rounded-lg p-2 text-indigo-600 hover:bg-white/80" onClick={() => setRefresh((value) => value + 1)} type="button"><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /></button></div>
      <Link className="mt-2 inline-block text-xs font-semibold text-indigo-600 hover:underline" href={`/chat/${encodeURIComponent(conversationId)}`}>Abrir a conversa e suas mensagens</Link>
      <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">VoiceSessions · {sessions.length}</p>
      <div className="mt-2 max-h-[32rem] space-y-2 overflow-y-auto">
        {sessions.map((session) => <button className={`w-full rounded-xl border p-3 text-left transition ${session.id === selectedId ? "border-indigo-200 bg-indigo-50/80" : "border-white/80 bg-white/50 hover:bg-white/80"}`} key={session.id} onClick={() => setSelectedId(session.id)} type="button"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-slate-800">{session.mode === "wake" ? "Wake" : "Live"}</span><span className="text-[10px] text-slate-500">{session.state ?? (session.endedAt ? "encerrada" : "ativa")}</span></div><p className="mt-1 break-all font-mono text-[10px] text-slate-500">{session.id}</p><p className="mt-1 text-[10px] text-slate-500">{dateLabel(session.startedAt)}</p></button>)}
        {!loading && !sessions.length ? <p className="rounded-xl border border-dashed border-slate-200 p-4 text-xs text-slate-500">Esta Conversation ainda não tem sessões de voz.</p> : null}
      </div>
    </aside>
    <div className="glass min-w-0 rounded-[1.7rem] p-5 sm:p-7">
      {error ? <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</p> : null}
      {loading ? <p className="flex items-center gap-2 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" /> Carregando sessões</p> : selected ? <>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-indigo-600">Pipeline de voz</p><h2 className="mt-1 flex items-center gap-2 text-lg font-semibold text-slate-950"><Volume2 className="size-5" /> VoiceSession</h2></div><span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">{selected.mode.toUpperCase()} · {selected.state ?? (selected.endedAt ? "concluída" : "ativa")}</span></div>
        <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><Stat label="Conversation" value={selected.conversationId} /><Stat label="VoiceSession" value={selected.id} /><Stat label="Início" value={dateLabel(selected.startedAt)} /><Stat label="Fim" value={selected.endedAt ? dateLabel(selected.endedAt) : "Em andamento"} /></div>
        {interactions.length ? <section className="mt-6"><h3 className="text-sm font-semibold text-slate-900">Mensagens nesta Conversation · {interactions.length} interação(ões)</h3><div className="mt-3 space-y-3">{interactions.map(({ event, user, assistant, research }) => <div className="rounded-xl border border-indigo-100 bg-indigo-50/45 p-3" key={event.id}><p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600">VoiceSession → mensagens {research ? "→ pesquisa" : ""}</p><p className="mt-2 text-xs text-slate-700"><span className="font-semibold">Você:</span> {user?.content ?? String(event.data.userMessageId ?? "Mensagem indisponível")}</p><p className="mt-2 text-xs text-slate-800"><span className="font-semibold">Luna:</span> {assistant?.content ?? String(event.data.assistantMessageId ?? "Resposta indisponível")}</p><div className="mt-3 flex flex-wrap gap-3 text-[11px] font-semibold text-indigo-700"><Link href={`/chat/${encodeURIComponent(conversationId)}`}>Ver histórico textual</Link>{research ? <Link href={`/observability?conversation=${encodeURIComponent(conversationId)}&view=research&run=${encodeURIComponent(research.id)}`}>Ver pesquisa e evidências</Link> : null}</div></div>)}</div></section> : null}
        <h3 className="mt-7 text-sm font-semibold text-slate-900">Eventos · {events.length}</h3>
        <div className="mt-3 max-h-[38rem] space-y-2 overflow-y-auto pr-1">
          {events.map((event) => <article className="rounded-xl border border-white/80 bg-white/55 p-3" key={event.id}><div className="flex flex-wrap items-center justify-between gap-2"><p className="flex items-center gap-2 text-xs font-semibold text-slate-800"><Activity className="size-3.5 text-indigo-500" />{event.type}</p><time className="text-[10px] text-slate-500">{dateLabel(event.createdAt)}</time></div>{Object.keys(event.data ?? {}).length ? <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50/80 px-3 py-2 font-mono text-[10px] leading-5 text-slate-600">{JSON.stringify(event.data, null, 2)}</pre> : null}</article>)}
          {!events.length ? <p className="rounded-xl border border-dashed border-slate-200 p-4 text-xs text-slate-500">Nenhum evento registrado nesta sessão.</p> : null}
        </div>
      </> : <p className="text-sm text-slate-500">Selecione uma sessão para acompanhar wake, STT, resposta e TTS.</p>}
    </div>
  </section>;
}

function Stat({ label, value }: { label: string; value: string }) { return <div className="min-w-0 rounded-xl border border-white/80 bg-white/50 p-3"><p className="text-[10px] text-slate-500">{label}</p><p className="mt-1 break-all text-xs font-semibold text-slate-800">{value}</p></div>; }
function dateLabel(value: string) { return value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value)) : "—"; }
