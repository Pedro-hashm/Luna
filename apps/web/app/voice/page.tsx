"use client";

import { LoaderCircle, Mic2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getSettings } from "@/lib/conversation-api";
import { createVoiceSession, endVoiceSession, type VoiceSession } from "@/lib/voice-api";

export default function VoiceEntryPage() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const sessionPromiseRef = useRef<Promise<VoiceSession> | undefined>(undefined);
  const handoffRef = useRef(false);
  const endTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    let active = true;
    if (endTimerRef.current) clearTimeout(endTimerRef.current);
    // A direct visit needs the regular Conversation id before the canonical voice route exists.
    if (!sessionPromiseRef.current) sessionPromiseRef.current = getSettings().then((settings) => {
      if (!settings.application.voiceEnabled) throw new Error("A interface de voz está desativada nas configurações.");
      return createVoiceSession({ mode: settings.application.voiceDefaultMode });
    });
    void sessionPromiseRef.current.then((session) => {
      if (active) {
        handoffRef.current = true;
        router.replace(`/voice/${encodeURIComponent(session.conversationId)}?session=${encodeURIComponent(session.id)}`);
      }
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Não foi possível iniciar a conversa por voz.");
    });
    return () => {
      active = false;
      if (!handoffRef.current) endTimerRef.current = window.setTimeout(() => {
        void sessionPromiseRef.current?.then((opened) => {
          if (!handoffRef.current) return endVoiceSession(opened.id);
        }).catch(() => undefined);
      }, 200);
    };
  }, [router]);

  return <main className="flex h-dvh items-center justify-center px-6">
    <section className="glass max-w-md rounded-3xl p-8 text-center">
      {error ? <Mic2 className="mx-auto size-8 text-rose-500" /> : <LoaderCircle className="mx-auto size-8 animate-spin text-indigo-500" />}
      <h1 className="mt-5 text-xl font-semibold text-slate-950">{error ? "Voz indisponível" : "Preparando a conversa por voz"}</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">{error ?? "Criando uma sessão vinculada à sua conversa."}</p>
      {error ? <Link className="mt-6 inline-block rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white" href="/">Voltar ao chat</Link> : null}
    </section>
  </main>;
}
