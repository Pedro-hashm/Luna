"use client";

import { Play, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getVoiceProfiles, voiceProfilePreviewUrl } from "@/lib/voice-api";
import type { VoiceProfile } from "@/lib/voice-api";

export function VoiceProfilesSettings({ engine, selectedProfileId, onSelected }: { engine: "kokoro" | "qwen" | "qwen-fast" | "f5" | "fish"; selectedProfileId: string; onSelected?: (id: string) => void }) {
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [error, setError] = useState<string>();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let active = true;
    void getVoiceProfiles().then((response) => {
      if (!active) return;
      setProfiles(response.profiles);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Não foi possível listar as vozes.");
    });
    return () => { active = false; audioRef.current?.pause(); };
  }, []);

  function preview(id: string) {
    audioRef.current?.pause();
    const audio = new Audio(voiceProfilePreviewUrl(id));
    audioRef.current = audio;
    void audio.play().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Não foi possível ouvir a prévia."));
  }

  const selected = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles.find((profile) => profile.id === "pf_dora");

  return <div className="space-y-4 sm:col-span-2">
    <div className="rounded-2xl border border-white/90 bg-white/55 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Volume2 className="size-4 text-indigo-600" /> Voz da Luna</h3><p className="mt-1 text-xs text-slate-500">Kokoro tem Dora original e a variante Luna Nobre; Qwen3-TTS e F5-TTS usam clonagem de voz; Fish Audio usa o reference_id configurado acima.</p></div>
      </div>
      {error ? <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-100 bg-white/70 px-3 py-2">
        {engine === "kokoro" ? <>
          <label className="min-w-48 flex-1"><span className="mb-1 block text-[10px] font-medium text-slate-500">Voz Kokoro · português brasileiro</span><select className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-800" value={selected?.id ?? "pf_dora"} onChange={(event) => onSelected?.(event.target.value)}>
            {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.id === "pf_dora" ? "Dora · original" : profile.name === "Luna Nobre" ? "Luna Nobre · refinada" : profile.name}</option>)}
          </select></label>
          <div className="min-w-32 flex-1"><p className="text-xs font-semibold text-slate-800">{selected?.id === "pf_dora" ? "Dora original" : selected?.name ?? "Dora"} · em uso</p><p className="mt-0.5 text-[10px] text-slate-500">{selected?.id === "pf_luna_nobre" ? "Timbre mais claro · ritmo 4% mais calmo" : "Voz feminina original do Kokoro"}</p></div>
          <button className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50" disabled={!selected} onClick={() => selected && preview(selected.id)} type="button"><Play className="size-3" /> Ouvir prévia</button>
        </> : <div className="min-w-32 flex-1"><p className="text-xs font-semibold text-slate-800">{engine === "fish" ? "Voz Fish Audio configurada" : "Clone de voz · em uso"}</p><p className="mt-0.5 text-[10px] text-slate-500">{engine === "fish" ? "O ID de referência fica salvo nas configurações do motor. A seleção Kokoro continua guardada para quando você voltar a esse motor." : `Português brasileiro · ${engine === "qwen" ? "Qwen3-TTS" : engine === "qwen-fast" ? "Faster Qwen3-TTS" : "F5-TTS pt-BR"}. A voz Kokoro fica salva para quando você voltar a esse motor.`}</p></div>}
      </div>
    </div>
  </div>;
}
