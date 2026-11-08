"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readMemoryQueue, type MemoryQueue, type MemoryQueueEntry } from "@/lib/memory-api";

const statuses: Record<MemoryQueueEntry["state"], string> = {
  pending: "Aguardando análise",
  processing: "Em análise",
  failed: "Falhou",
  processed: "Analisada",
};
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

function QueueEntries({ entries }: { entries: MemoryQueueEntry[] }) {
  return (
    <ul className="mt-2 space-y-2">
      {entries.map(entry => (
        <li key={entry.messageId} className="rounded-2xl border border-indigo-100 bg-white/65 p-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
            <span className={entry.state === "failed" ? "font-semibold text-rose-800" : "font-semibold text-indigo-800"}>
              {statuses[entry.state]}
            </span>
            <time dateTime={entry.createdAt}>{dateTime.format(new Date(entry.createdAt))}</time>
            {entry.inputMode === "voice" && <span>Voz</span>}
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800">{entry.preview || "Mensagem sem texto"}</p>
          <Link href={"/chat/" + encodeURIComponent(entry.conversationId)} prefetch={false}
            className="mt-2 inline-block text-xs font-semibold text-indigo-800 hover:underline">
            Ver conversa
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function MemoryQueuePanel({ refreshVersion }: { refreshVersion: number }) {
  const [page, setPage] = useState(1);
  const [snapshot, setSnapshot] = useState<{ page: number; queue: MemoryQueue }>();
  const [error, setError] = useState(false);
  const queue = snapshot?.page === page ? snapshot.queue : undefined;

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;

    async function refresh() {
      try {
        const result = await readMemoryQueue(page, controller.signal);
        if (controller.signal.aborted) return;
        setError(false);
        if (page > result.pageCount) setPage(result.pageCount);
        else setSnapshot({ page, queue: result });
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(refresh, 5000);
      }
    }

    void refresh();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [page, refreshVersion]);

  return (
    <div className="mt-4 space-y-4">
      {error && <p role="alert" className="text-sm text-rose-800">Não foi possível atualizar a fila. Tentando novamente…</p>}
      {!queue && !error && <p role="status" className="text-sm text-slate-600">Carregando fila…</p>}
      {queue && <>
        <section aria-labelledby="memory-queue-title">
          <h3 id="memory-queue-title" className="text-sm font-semibold text-slate-900">Fila de análise</h3>
          <p aria-live="polite" className="mt-1 text-sm text-slate-600">
            {queue.pending === 1 ? "1 mensagem na fila" : queue.pending + " mensagens na fila"}
            {queue.failed > 0 && " · " + queue.failed + (queue.failed === 1 ? " falhou" : " falharam")}
          </p>
          {queue.active.length ? <QueueEntries entries={queue.active} /> : <p className="mt-2 text-sm text-slate-600">Nenhuma mensagem aguardando análise.</p>}
          {queue.pageCount > 1 && <nav className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-600" aria-label="Páginas da fila de análise">
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}
              className="rounded-md border border-indigo-100 px-2 py-1 font-semibold disabled:opacity-40">Anterior</button>
            <span>Página {page} de {queue.pageCount}</span>
            <button type="button" disabled={page >= queue.pageCount} onClick={() => setPage(page + 1)}
              className="rounded-md border border-indigo-100 px-2 py-1 font-semibold disabled:opacity-40">Próxima</button>
          </nav>}
        </section>
        {queue.recent.length > 0 && <section aria-labelledby="memory-queue-recent-title">
          <h3 id="memory-queue-recent-title" className="text-sm font-semibold text-slate-900">Mensagens recentes já analisadas</h3>
          <QueueEntries entries={queue.recent} />
        </section>}
      </>}
    </div>
  );
}

