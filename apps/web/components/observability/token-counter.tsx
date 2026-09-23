import { Gauge } from "lucide-react";

export function estimateUiTokens(content: string): number {
  return content ? Math.max(1, Math.ceil(content.length / 4)) : 0;
}

export function TokenCounter({
  historyTokens,
  inputTokens,
  toolsTokens,
  outputTokens,
  maxTokens = 32000,
}: {
  historyTokens: number;
  inputTokens: number;
  toolsTokens: number;
  outputTokens: number;
  maxTokens?: number;
}) {
  const contextTokens = historyTokens + inputTokens + toolsTokens;
  const percentage = Math.min(100, (contextTokens / maxTokens) * 100);
  const memoryTokens = 0;

  return (
    <div className="rounded-2xl border border-white/80 bg-white/42 px-3.5 py-2.5 backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          <Gauge className="size-3.5 text-indigo-500" />
          Contexto estimado
        </div>
        <span className="text-[10px] font-medium text-slate-500">
          {formatCompact(contextTokens)} / {formatCompact(maxTokens)}
        </span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-200/70">
        <div
          className={`h-full rounded-full transition-all duration-300 ${percentage > 85 ? "bg-amber-500" : "bg-indigo-400"}`}
          style={{ width: `${Math.max(percentage, contextTokens ? 1 : 0)}%` }}
        />
      </div>
      <div className="mt-2 grid grid-cols-5 gap-2 text-[10px] text-slate-500">
        <TokenLine label="Input" value={inputTokens} />
        <TokenLine label="Memory" value={memoryTokens} />
        <TokenLine label="History" value={historyTokens} />
        <TokenLine label="Tools" value={toolsTokens} />
        <TokenLine label="Output" value={outputTokens} />
      </div>
    </div>
  );
}

function TokenLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <p className="truncate">{label}</p>
      <p className="mt-0.5 font-semibold text-slate-700">{formatCompact(value)}</p>
    </div>
  );
}

function formatCompact(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  }

  return String(value);
}
