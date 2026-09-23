import {
  Brain,
  ChevronRight,
  CircleDot,
  Database,
  MessageCircle,
  Sparkles,
  Wrench,
} from "lucide-react";

export type BrainStage = "user" | "context" | "orchestrator" | "tools" | "memory" | "luna";

const stages: Array<{
  id: BrainStage;
  label: string;
  icon: typeof MessageCircle;
}> = [
  { id: "user", label: "Você", icon: MessageCircle },
  { id: "context", label: "Context", icon: CircleDot },
  { id: "orchestrator", label: "Orchestrator", icon: Brain },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "memory", label: "Memory", icon: Database },
  { id: "luna", label: "Luna", icon: Sparkles },
];

export function BrainFlow({
  activeStage,
  completedStages = [],
  compact = false,
}: {
  activeStage?: BrainStage;
  completedStages?: BrainStage[];
  compact?: boolean;
}) {
  return (
    <div className={`flex items-center overflow-x-auto ${compact ? "gap-1.5" : "gap-2"}`}>
      {stages.map((stage, index) => {
        const Icon = stage.icon;
        const active = activeStage === stage.id;
        const completed = completedStages.includes(stage.id);

        return (
          <div className="flex shrink-0 items-center gap-1.5" key={stage.id}>
            <div
              className={`flex items-center gap-1.5 rounded-full border transition-all duration-500 ${
                compact ? "px-2 py-1" : "px-2.5 py-1.5"
              } ${
                active
                  ? "border-indigo-200 bg-indigo-50/95 text-indigo-700 shadow-[0_0_0_4px_rgba(129,140,248,0.10)]"
                  : completed
                    ? "border-emerald-200/80 bg-emerald-50/75 text-emerald-700"
                    : "border-white/80 bg-white/45 text-slate-400"
              }`}
            >
              <Icon className={`${compact ? "size-3" : "size-3.5"} ${active ? "animate-pulse" : ""}`} />
              <span className={compact ? "text-[10px] font-medium" : "text-[11px] font-medium"}>
                {stage.label}
              </span>
            </div>
            {index < stages.length - 1 ? (
              <ChevronRight className={`${compact ? "size-3" : "size-3.5"} text-slate-300`} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
