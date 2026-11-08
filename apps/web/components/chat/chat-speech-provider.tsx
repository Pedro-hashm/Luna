"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { readChatSpeech } from "@/lib/voice-api";

type Target = { conversationId: string; messageId: string };
type Playback = Target & { status: "loading" | "playing" | "blocked" | "error"; error?: string };
type Reading = Target & {
  audio: HTMLAudioElement;
  abort: AbortController;
  url?: string;
  offset: number;
  next: number | null;
};
type ChatSpeech = {
  playback?: Playback;
  toggleMessage: (target: Target) => void;
  enqueueResponse: (target: Target, fromNewChat: boolean) => void;
  stop: () => void;
};

const SpeechContext = createContext<ChatSpeech | null>(null);
const chatPath = (id: string) => "/chat/" + encodeURIComponent(id);
const isSame = (a: Target | undefined, b: Target) =>
  a?.conversationId === b.conversationId && a.messageId === b.messageId;

export function ChatSpeechProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [playback, setPlayback] = useState<Playback>();
  const active = useRef<Reading | undefined>(undefined);
  const queue = useRef<Target[]>([]);

  const cancelCurrent = useCallback(() => {
    const reading = active.current;
    active.current = undefined;
    if (!reading) return;
    reading.abort.abort();
    reading.audio.onended = null;
    reading.audio.onerror = null;
    reading.audio.pause();
    reading.audio.removeAttribute("src");
    reading.audio.load();
    if (reading.url) URL.revokeObjectURL(reading.url);
  }, []);

  const stop = useCallback(() => {
    queue.current = [];
    cancelCurrent();
    setPlayback(undefined);
  }, [cancelCurrent]);

  useEffect(() => {
    if (active.current && pathname !== chatPath(active.current.conversationId)) stop();
  }, [pathname, stop]);
  useEffect(() => cancelCurrent, [cancelCurrent]);

  function state(reading: Reading, status: Playback["status"], error?: string) {
    setPlayback({ conversationId: reading.conversationId, messageId: reading.messageId, status, error });
  }

  function finish(reading: Reading, error?: string) {
    if (active.current !== reading) return;
    cancelCurrent();
    if (error) state(reading, "error", error);
    else setPlayback(undefined);
    const next = queue.current.shift();
    if (next) start(next);
  }

  async function play(reading: Reading) {
    try {
      await reading.audio.play();
      if (active.current === reading) state(reading, "playing");
    } catch (error) {
      if (active.current !== reading) return;
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        state(reading, "blocked", "Clique em Ouvir para liberar o áudio neste navegador.");
      } else {
        finish(reading, "Não foi possível reproduzir o áudio.");
      }
    }
  }

  async function load(reading: Reading) {
    state(reading, "loading");
    try {
      const segment = await readChatSpeech(reading.conversationId, reading.messageId, reading.offset, reading.abort.signal);
      if (active.current !== reading) return;
      if (reading.url) URL.revokeObjectURL(reading.url);
      reading.next = segment.next;
      reading.url = URL.createObjectURL(segment.audio);
      reading.audio.src = reading.url;
      await play(reading);
    } catch (error) {
      if (active.current === reading) finish(reading, error instanceof Error ? error.message : "Não foi possível gerar o áudio.");
    }
  }

  function start(target: Target) {
    const reading: Reading = { ...target, audio: new Audio(), abort: new AbortController(), offset: 0, next: null };
    active.current = reading;
    reading.audio.onended = () => {
      if (active.current !== reading) return;
      if (reading.next === null) finish(reading);
      else {
        reading.offset = reading.next;
        void load(reading);
      }
    };
    reading.audio.onerror = () => finish(reading, "Não foi possível reproduzir o áudio.");
    void load(reading);
  }

  function toggleMessage(target: Target) {
    const reading = active.current;
    if (reading && isSame(reading, target)) {
      if (playback?.status === "blocked") void play(reading);
      else finish(reading);
      return;
    }
    queue.current = queue.current.filter(item => !isSame(item, target));
    cancelCurrent();
    start(target);
  }

  function enqueueResponse(target: Target, fromNewChat: boolean) {
    const currentPath = window.location.pathname;
    if (currentPath !== chatPath(target.conversationId) && !(fromNewChat && currentPath === "/")) return;
    if (isSame(active.current, target) || queue.current.some(item => isSame(item, target))) return;
    if (active.current) queue.current.push(target);
    else start(target);
  }

  return <SpeechContext.Provider value={{ playback, toggleMessage, enqueueResponse, stop }}>{children}</SpeechContext.Provider>;
}

export function useChatSpeech() {
  const speech = useContext(SpeechContext);
  if (!speech) throw new Error("ChatSpeechProvider is required.");
  return speech;
}
