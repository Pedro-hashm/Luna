"use client";

import Link from "next/link";
import { Brain, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { listMemoryActivity, undoMemoryChange, type MemoryChatChange } from "@/lib/memory-api";

export function useChatMemoryChanges(conversationId: string | undefined, latestMessageId: string | undefined) {
  const [activity, setActivity] = useState<{ id: string; changes: MemoryChatChange[] }>();
  useEffect(() => {
    if (!conversationId) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retry = true;
    async function refresh(id: string) {
      try {
        const result = await listMemoryActivity(id, abort.signal);
        if (abort.signal.aborted) return;
        retry = true;
        setActivity({ id, changes: result.changes });
        if (result.pending) timer = setTimeout(() => void refresh(id), 2000);
      } catch {
        if (!abort.signal.aborted && retry) {
          retry = false;
          timer = setTimeout(() => void refresh(id), 3000);
        }
      }
    }
    void refresh(conversationId);
    return () => { abort.abort(); clearTimeout(timer); };
  }, [conversationId, latestMessageId]);
  return activity?.id === conversationId ? activity?.changes ?? [] : [];
}

export function ChatMemoryNotice({ change }: { change: MemoryChatChange }) {
  const [view, setView] = useState(false);
  const [busy, setBusy] = useState(false);
  const [undone, setUndone] = useState(false);
  const [error, setError] = useState("");
  const memory = change.memory;
  const link = "rounded px-1.5 py-0.5 font-semibold text-indigo-800 hover:bg-indigo-100 disabled:opacity-50";
  async function undo() {
    setBusy(true);
    setError("");
    try {
      await undoMemoryChange(change.id);
      setUndone(true);
      setView(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível desfazer a gravação.");
    } finally {
      setBusy(false);
    }
  }
  if (undone || change.status === "undone") {
    return <p role="status" className="mt-1 text-xs text-slate-600">Gravação de memória desfeita.</p>;
  }
  if (!memory) return null;
  return (
    <div className="mt-1 rounded-xl border border-indigo-100 bg-indigo-50/90 px-2.5 py-1.5 text-left text-xs text-slate-700">
      <div className="flex flex-wrap items-center gap-1">
        <Brain aria-hidden="true" className="mr-0.5 size-3.5 text-indigo-700" />
        <span className="font-medium">{change.updated ? "Memória atualizada" : "Memória salva"} · {memory.predicate}</span>
        <button type="button" className={link} aria-expanded={view} onClick={() => setView(value => !value)}>{view ? "Fechar" : "Ver"}</button>
        <button type="button" className={link + " inline-flex items-center gap-1"} disabled={busy || !memory.canUndo}
          title={memory.canUndo ? undefined : "A memória foi editada ou confirmada depois desta gravação."}
          onClick={() => void undo()}><Undo2 aria-hidden="true" className="size-3" />{busy ? "Desfazendo…" : "Desfazer"}</button>
      </div>
      {view && <div className="mt-1.5 space-y-1 border-t border-indigo-100 pt-1.5">
        <p className="break-words font-medium">{memory.value}</p>
        {memory.quote && <blockquote className="break-words text-slate-600">{memory.quote}</blockquote>}
        <p>{memory.allowModel ? "Disponível em outros chats quando relevante." : "Privada no painel de memórias."}</p>
        <Link className="font-medium text-indigo-800 underline" href={"/settings/memory?item=" + encodeURIComponent(memory.id)}>Privacidade e versões</Link>
      </div>}
      {error && <p role="alert" className="mt-1 text-red-700">{error}</p>}
    </div>
  );
}
