"use client";

import {
  Activity,
  ArrowLeft,
  AudioLines,
  CircleAlert,
  Headphones,
  LoaderCircle,
  Mic2,
  MicOff,
  RefreshCw,
  Settings2,
  Square,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { WakeModelStatusBadge } from "@/components/voice/wake-model-status";
import { getConversation, getSettings, type ApplicationSettings } from "@/lib/conversation-api";
import {
  createVoiceSession,
  endVoiceSession,
  getVoiceSession,
  getVoiceProfiles,
  selectVoiceProfile,
  voiceWebSocketUrl,
  type VoiceMode,
  type VoiceProfile,
  type VoiceSession,
  type VoiceState,
} from "@/lib/voice-api";

type UiState = {
  state: VoiceState;
  connected: boolean;
  transcript: string;
  response: string;
  error?: string;
};

type UiAction =
  | { type: "state"; state: VoiceState }
  | { type: "connected"; connected: boolean }
  | { type: "transcript"; text: string }
  | { type: "response"; text: string }
  | { type: "error"; message: string }
  | { type: "reset" };

const initialUiState: UiState = { state: "idle", connected: false, transcript: "", response: "" };
const preferredMicrophoneStorageKey = "luna.voice.microphoneDeviceId";
const microphonePreferenceEvent = "luna:microphone-preference-changed";
let microphonePreferenceMemory = "";

function subscribeToMicrophonePreference(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(microphonePreferenceEvent, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(microphonePreferenceEvent, onChange);
  };
}

function getMicrophonePreference() {
  try {
    const stored = window.localStorage.getItem(preferredMicrophoneStorageKey);
    if (stored !== null) return stored;
  } catch { /* Use the in-memory choice for this page when storage is blocked. */ }
  return microphonePreferenceMemory;
}

function voiceReducer(current: UiState, action: UiAction): UiState {
  switch (action.type) {
    case "state": return { ...current, state: action.state, error: undefined };
    case "connected": return { ...current, connected: action.connected };
    case "transcript": return { ...current, transcript: action.text };
    case "response": return { ...current, response: action.text };
    case "error": return { ...current, state: "error", error: action.message };
    case "reset": return initialUiState;
  }
}

const stateLabels: Record<VoiceState, string> = {
  idle: "Aguardando “Luna”",
  wake_detected: "Luna ouviu você",
  listening: "Ouvindo você",
  transcribing: "Transcrevendo",
  thinking: "Pensando",
  speaking: "Falando",
  error: "Atenção necessária",
};

type ServerEvent = {
  type?: string;
  state?: VoiceState;
  text?: string;
  message?: string;
  mimeType?: string;
  data?: string;
};

export function VoiceShell({ conversationId, initialSessionId }: { conversationId: string; initialSessionId?: string }) {
  const [ui, dispatch] = useReducer(voiceReducer, initialUiState);
  const [mode, setMode] = useState<VoiceMode>("wake");
  const [session, setSession] = useState<VoiceSession>();
  const [conversationTitle, setConversationTitle] = useState("Conversa");
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>();
  const [settings, setSettings] = useState<ApplicationSettings>();
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const microphoneId = useSyncExternalStore(subscribeToMicrophonePreference, getMicrophonePreference, () => "");
  const [activeMicrophoneLabel, setActiveMicrophoneLabel] = useState("");
  const [microphoneBusy, setMicrophoneBusy] = useState(false);
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const [events, setEvents] = useState<Array<{ at: string; label: string }>>([]);
  const [starting, setStarting] = useState(false);
  const [switching, setSwitching] = useState(false);
  const sessionRef = useRef<VoiceSession | undefined>(undefined);
  const sessionPromiseRef = useRef<Promise<VoiceSession> | undefined>(undefined);
  const endTimerRef = useRef<number | undefined>(undefined);
  const wsRef = useRef<WebSocket | undefined>(undefined);
  const mediaRef = useRef<MediaStream | undefined>(undefined);
  const captureCtxRef = useRef<AudioContext | undefined>(undefined);
  const playbackCtxRef = useRef<AudioContext | undefined>(undefined);
  const workletRef = useRef<AudioWorkletNode | undefined>(undefined);
  const sourceRef = useRef<AudioBufferSourceNode | undefined>(undefined);
  const playbackFrameRef = useRef<number | undefined>(undefined);
  const stateRef = useRef<VoiceState>("idle");
  const modeRef = useRef<VoiceMode>("wake");
  const bargeEnabledRef = useRef(true);
  const bargeFramesRef = useRef(0);
  const speakingStartedRef = useRef(0);
  const speechStartedRef = useRef(false);
  const lastLoudRef = useRef(0);
  const lastVisualRef = useRef(0);
  const playbackGenerationRef = useRef(0);
  const listeningArmedRef = useRef(false);
  const wakeNoiseFloorRef = useRef(0.002);
  const wakeGateOpenRef = useRef(false);
  const wakeLastLoudRef = useRef(0);
  const wakePrerollRef = useRef<ArrayBuffer[]>([]);
  const awaitingWakeCommandRef = useRef(false);
  const wakeListeningSinceRef = useRef(0);
  const wakeQuietSinceRef = useRef(0);
  const mountedRef = useRef(false);
  const switchingRef = useRef(false);

  const refreshMicrophones = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMicrophones(devices.filter((device) => device.kind === "audioinput"));
    } catch {
      // Device listing may be unavailable until microphone permission is granted.
    }
  }, []);

  function transition(state: VoiceState) {
    const previous = stateRef.current;
    stateRef.current = state;
    if (state === "listening") {
      speechStartedRef.current = false;
      lastLoudRef.current = 0;
      wakeGateOpenRef.current = false;
      wakePrerollRef.current = [];
      awaitingWakeCommandRef.current = modeRef.current === "wake" && previous === "wake_detected";
      wakeListeningSinceRef.current = performance.now();
      wakeQuietSinceRef.current = 0;
    }
    if (state === "speaking") speakingStartedRef.current = performance.now();
    dispatch({ type: "state", state });
    addEvent(stateLabels[state]);
  }

  function addEvent(label: string) {
    const at = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setEvents((current) => [...current.slice(-7), { at, label }]);
  }

  function sendControl(type: string) {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type }));
  }

  function stopPlayback() {
    playbackGenerationRef.current += 1;
    if (playbackFrameRef.current) cancelAnimationFrame(playbackFrameRef.current);
    playbackFrameRef.current = undefined;
    const source = sourceRef.current;
    sourceRef.current = undefined;
    if (source) {
      source.onended = null;
      try { source.stop(); } catch { /* already stopped */ }
      source.disconnect();
    }
    setOutputLevel(0);
  }

  function playWakeChime() {
    const context = playbackCtxRef.current;
    if (!context || context.state === "closed") return;

    const scheduleChime = () => {
      if (context.state !== "running") return;
      try {
        const startAt = context.currentTime + 0.01;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(660, startAt);
        oscillator.frequency.linearRampToValueAtTime(880, startAt + 0.14);
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.linearRampToValueAtTime(0.1, startAt + 0.015);
        gain.gain.linearRampToValueAtTime(0.0001, startAt + 0.2);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(startAt);
        oscillator.stop(startAt + 0.21);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
        };
      } catch {
        // A wake cue is optional; audio capture should continue if playback fails.
      }
    };

    if (context.state === "suspended") {
      void context.resume().then(scheduleChime).catch(() => undefined);
      return;
    }
    scheduleChime();
  }

  async function playAudio(encoded: string) {
    stopPlayback();
    const generation = playbackGenerationRef.current;
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const context = playbackCtxRef.current ?? new AudioContext();
    playbackCtxRef.current = context;
    if (context.state === "suspended") await context.resume();
    const audio = await context.decodeAudioData(bytes.buffer);
    if (generation !== playbackGenerationRef.current) return;
    const source = context.createBufferSource();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.buffer = audio;
    source.connect(analyser);
    analyser.connect(context.destination);
    sourceRef.current = source;
    const samples = new Float32Array(analyser.fftSize);
    function measure() {
      if (generation !== playbackGenerationRef.current || sourceRef.current !== source) return;
      analyser.getFloatTimeDomainData(samples);
      let power = 0;
      for (const sample of samples) power += sample * sample;
      setOutputLevel(Math.min(1, Math.sqrt(power / samples.length) * 6));
      playbackFrameRef.current = requestAnimationFrame(measure);
    }
    source.onended = () => {
      if (generation !== playbackGenerationRef.current) return;
      if (playbackFrameRef.current) cancelAnimationFrame(playbackFrameRef.current);
      sourceRef.current = undefined;
      analyser.disconnect();
      source.disconnect();
      setOutputLevel(0);
      sendControl("playback.complete");
      addEvent("Áudio reproduzido");
    };
    source.start();
    measure();
  }

  function closeAudio(endSession = false) {
    stopPlayback();
    const socket = wsRef.current;
    wsRef.current = undefined;
    if (socket) {
      if (endSession && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "session.end" }));
      socket.onclose = null;
      socket.close();
    }
    workletRef.current?.disconnect();
    workletRef.current = undefined;
    mediaRef.current?.getTracks().forEach((track) => track.stop());
    mediaRef.current = undefined;
    setActiveMicrophoneLabel("");
    void captureCtxRef.current?.close();
    captureCtxRef.current = undefined;
    void playbackCtxRef.current?.close();
    playbackCtxRef.current = undefined;
    listeningArmedRef.current = false;
    stateRef.current = "idle";
    awaitingWakeCommandRef.current = false;
    wakeGateOpenRef.current = false;
    wakePrerollRef.current = [];
    dispatch({ type: "connected", connected: false });
    dispatch({ type: "reset" });
    setInputLevel(0);
  }

  function finalizeUtterance() {
    if (stateRef.current !== "listening") return;
    sendControl("listen.stop");
    listeningArmedRef.current = false;
    speechStartedRef.current = false;
    transition("transcribing");
  }

  function handleMicrophoneFrame(pcm: ArrayBuffer, rms: number) {
    const now = performance.now();
    if (now - lastVisualRef.current > 45) {
      setInputLevel(Math.min(1, rms * 8));
      lastVisualRef.current = now;
    }
    const state = stateRef.current;
    if (state === "speaking" && bargeEnabledRef.current && now - speakingStartedRef.current > 350) {
      bargeFramesRef.current = rms > 0.055 ? bargeFramesRef.current + 1 : 0;
      if (bargeFramesRef.current >= 5) {
        bargeFramesRef.current = 0;
        stopPlayback();
        sendControl("barge_in");
        transition("listening");
        addEvent("Fala interrompida por você");
      }
      return;
    }
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    if (modeRef.current === "wake" && state === "idle") {
      // Cheap browser energy gate: retain 400 ms before speech, then keep a
      // 700 ms tail. Digital silence never crosses the WebSocket.
      const threshold = Math.max(0.009, wakeNoiseFloorRef.current * 2.7);
      if (!wakeGateOpenRef.current) {
        wakeNoiseFloorRef.current = wakeNoiseFloorRef.current * 0.995 + rms * 0.005;
        wakePrerollRef.current.push(pcm);
        if (wakePrerollRef.current.length > 20) wakePrerollRef.current.shift();
        if (rms > threshold) {
          wakeGateOpenRef.current = true;
          wakeLastLoudRef.current = now;
          for (const frame of wakePrerollRef.current) wsRef.current.send(frame);
          wakePrerollRef.current = [];
        }
      } else {
        wsRef.current.send(pcm);
        if (rms > threshold * 0.55) wakeLastLoudRef.current = now;
        if (now - wakeLastLoudRef.current > 700) {
          wakeGateOpenRef.current = false;
          wakePrerollRef.current = [];
          sendControl("wake.reset");
        }
      }
      return;
    }
    if (modeRef.current === "wake" && state === "wake_detected") {
      wsRef.current.send(pcm);
      return;
    }
    if (state !== "listening") return;
    wsRef.current.send(pcm);
    if (awaitingWakeCommandRef.current) {
      // The end of “Luna” must not count as a complete question. Wait for a
      // small quiet gap, while still accepting a continuous one-utterance ask.
      if (rms < 0.012) {
        if (!wakeQuietSinceRef.current) wakeQuietSinceRef.current = now;
        if (now - wakeQuietSinceRef.current > 220) awaitingWakeCommandRef.current = false;
      } else {
        wakeQuietSinceRef.current = 0;
        if (now - wakeListeningSinceRef.current > 600) {
          awaitingWakeCommandRef.current = false;
          speechStartedRef.current = true;
          lastLoudRef.current = now;
        }
      }
      return;
    }
    if (rms > 0.026) {
      speechStartedRef.current = true;
      lastLoudRef.current = now;
    } else if (speechStartedRef.current && now - lastLoudRef.current > 900) {
      finalizeUtterance();
    }
  }

  async function connectAudio(activeSession: VoiceSession, activeMode: VoiceMode, requestedMicrophoneId = microphoneId) {
    if (wsRef.current || starting) return;
    setStarting(true);
    dispatch({ type: "reset" });
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) throw new Error("Este navegador não oferece captura de áudio compatível. Use HTTPS ou localhost em um navegador atualizado.");
      // Prepare speaker output from the microphone button gesture so browser
      // autoplay rules do not suppress the wake cue later.
      const playbackContext = playbackCtxRef.current ?? new AudioContext();
      playbackCtxRef.current = playbackContext;
      if (playbackContext.state === "suspended") void playbackContext.resume().catch(() => undefined);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          ...(requestedMicrophoneId ? { deviceId: { exact: requestedMicrophoneId } } : {}),
          // Preserve wake-word features; browser suppression can erase a
          // short "Luna" before the local detector receives it. Live mode
          // keeps echo cancellation for barge-in during speaker playback.
          echoCancellation: activeMode === "live",
          noiseSuppression: activeMode === "live",
          autoGainControl: false,
        },
      });
      if (!mountedRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      mediaRef.current = stream;
      const activeTrack = stream.getAudioTracks()[0];
      setActiveMicrophoneLabel(activeTrack?.label || "Microfone ativo");
      await refreshMicrophones();
      for (const track of stream.getAudioTracks()) {
        track.onended = () => {
          closeAudio();
          dispatch({ type: "error", message: "O microfone foi desconectado. Conecte-o e ative novamente." });
        };
      }
      const context = new AudioContext();
      captureCtxRef.current = context;
      await context.audioWorklet.addModule("/voice-pcm-worklet.js");
      if (!mountedRef.current) { closeAudio(); return; }
      const microphone = context.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(context, "voice-pcm-processor");
      workletRef.current = worklet;
      const silentOutput = context.createGain();
      silentOutput.gain.value = 0;
      microphone.connect(worklet).connect(silentOutput).connect(context.destination);
      worklet.port.onmessage = (event: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => handleMicrophoneFrame(event.data.pcm, event.data.rms);
      const socket = new WebSocket(voiceWebSocketUrl(activeSession.id));
      wsRef.current = socket;
      socket.onopen = () => {
        if (!mountedRef.current) { closeAudio(true); return; }
        dispatch({ type: "connected", connected: true });
        addEvent("Microfone e sessão conectados");
        if (activeMode === "live") {
          listeningArmedRef.current = true;
          sendControl("listen.start");
        } else {
          transition("idle");
        }
      };
      socket.onmessage = (event: MessageEvent<string>) => {
        let payload: ServerEvent;
        try { payload = JSON.parse(event.data) as ServerEvent; } catch { return; }
        if (payload.type === "state" && payload.state) {
          const previous = stateRef.current;
          transition(payload.state);
          if (payload.state === "listening" && activeMode === "live" && previous !== "listening" && !listeningArmedRef.current) {
            listeningArmedRef.current = true;
            sendControl("listen.start");
          }
        } else if (payload.type === "wake.detected" && activeMode === "wake") {
          playWakeChime();
        } else if (payload.type === "transcript" && typeof payload.text === "string") {
          dispatch({ type: "transcript", text: payload.text });
          addEvent("Fala transcrita");
        } else if (payload.type === "response" && typeof payload.text === "string") {
          dispatch({ type: "response", text: payload.text });
          addEvent("Resposta gerada");
        } else if (payload.type === "audio" && typeof payload.data === "string") {
          void playAudio(payload.data).catch((cause: unknown) => {
            dispatch({ type: "error", message: cause instanceof Error ? cause.message : "Não foi possível reproduzir o áudio." });
            sendControl("playback.complete");
          });
        } else if (payload.type === "audio.cancel") {
          stopPlayback();
        } else if (payload.type === "error") {
          dispatch({ type: "error", message: payload.message ?? "O serviço de voz encontrou um erro." });
          addEvent("Erro no pipeline de voz");
        }
      };
      socket.onerror = () => dispatch({ type: "error", message: "A conexão de voz falhou. Verifique se a API está acessível." });
      socket.onclose = () => {
        if (wsRef.current !== socket) return;
        closeAudio();
        dispatch({ type: "error", message: "A conexão de voz foi encerrada. Ative o microfone para reconectar." });
      };
    } catch (cause) {
      closeAudio();
      const message = cause instanceof DOMException && cause.name === "NotAllowedError"
        ? "Permissão do microfone negada. Autorize o acesso no navegador e tente novamente."
        : requestedMicrophoneId && cause instanceof DOMException && ["NotFoundError", "OverconstrainedError"].includes(cause.name)
          ? "O microfone selecionado não está disponível. Escolha outro dispositivo ou use o padrão do sistema."
        : cause instanceof DOMException && cause.name === "NotFoundError"
          ? "Nenhum microfone foi encontrado. Conecte um dispositivo e tente novamente."
          : cause instanceof DOMException && cause.name === "NotReadableError"
            ? "O microfone está ocupado ou indisponível. Feche outros aplicativos que o usam e tente novamente."
            : cause instanceof Error ? cause.message : "Não foi possível acessar o microfone.";
      dispatch({ type: "error", message });
    } finally {
      setStarting(false);
    }
  }

  async function selectMicrophone(nextMicrophoneId: string) {
    microphonePreferenceMemory = nextMicrophoneId;
    setActiveMicrophoneLabel("");
    try {
      if (nextMicrophoneId) window.localStorage.setItem(preferredMicrophoneStorageKey, nextMicrophoneId);
      else window.localStorage.removeItem(preferredMicrophoneStorageKey);
    } catch { /* The browser may block local storage; current selection still works. */ }
    window.dispatchEvent(new Event(microphonePreferenceEvent));
    if (!wsRef.current || !sessionRef.current) return;
    setMicrophoneBusy(true);
    const activeSession = sessionRef.current;
    const activeMode = modeRef.current;
    closeAudio();
    try {
      await connectAudio(activeSession, activeMode, nextMicrophoneId);
    } finally {
      setMicrophoneBusy(false);
    }
  }

  async function changeMode(nextMode: VoiceMode) {
    if (nextMode === modeRef.current || switchingRef.current || !mountedRef.current) return;
    switchingRef.current = true;
    setSwitching(true);
    const resume = Boolean(wsRef.current);
    closeAudio(true);
    const previous = sessionRef.current;
    if (previous) void endVoiceSession(previous.id).catch(() => undefined);
    modeRef.current = nextMode;
    setMode(nextMode);
    dispatch({ type: "reset" });
    try {
      const next = await createVoiceSession({ conversationId, mode: nextMode });
      if (!mountedRef.current) {
        await endVoiceSession(next.id).catch(() => undefined);
        return;
      }
      sessionRef.current = next;
      setSession(next);
      addEvent(`Modo ${nextMode === "wake" ? "Wake" : "Live"} ativado`);
      if (resume) await connectAudio(next, nextMode);
    } catch (cause) {
      if (mountedRef.current) dispatch({ type: "error", message: cause instanceof Error ? cause.message : "Não foi possível trocar o modo." });
    } finally {
      switchingRef.current = false;
      if (mountedRef.current) setSwitching(false);
    }
  }

  async function changeVoice(id: string) {
    try {
      await selectVoiceProfile(id);
      setSelectedProfileId(id);
      addEvent("Voz selecionada");
    } catch (cause) {
      dispatch({ type: "error", message: cause instanceof Error ? cause.message : "Não foi possível selecionar a voz." });
    }
  }

  useEffect(() => {
    let active = true;
    mountedRef.current = true;
    if (endTimerRef.current) clearTimeout(endTimerRef.current);
    void Promise.all([getSettings(), getVoiceProfiles(), getConversation(conversationId)]).then(async ([config, profileResponse, conversation]) => {
      if (!active) return;
      setSettings(config.application);
      setProfiles(profileResponse.profiles);
      setSelectedProfileId(profileResponse.selectedProfileId ?? undefined);
      setConversationTitle(conversation.title);
      bargeEnabledRef.current = config.application.voiceBargeInEnabled;
      if (!config.application.voiceEnabled) throw new Error("A interface de voz está desativada nas configurações.");
      const initialMode = config.application.voiceDefaultMode;
      modeRef.current = initialMode;
      setMode(initialMode);
      if (!sessionPromiseRef.current) {
        sessionPromiseRef.current = initialSessionId
          ? getVoiceSession(initialSessionId).then((existing) => {
              if (existing.conversationId !== conversationId || existing.endedAt) {
                throw new Error("Esta sessão de voz não pertence à conversa aberta ou já foi encerrada.");
              }
              return existing;
            })
          : createVoiceSession({ conversationId, mode: initialMode });
      }
      const opened = await sessionPromiseRef.current;
      if (!active) return;
      sessionRef.current = opened;
      setSession(opened);
      modeRef.current = opened.mode;
      setMode(opened.mode);
      if (initialSessionId) window.history.replaceState(window.history.state, "", `/voice/${encodeURIComponent(conversationId)}`);
    }).catch((cause: unknown) => {
      if (active) dispatch({ type: "error", message: cause instanceof Error ? cause.message : "Não foi possível abrir a sessão de voz." });
    });
    const onPageHide = () => {
      if (sessionRef.current) {
        sendControl("session.end");
        navigator.sendBeacon(`/api/voice/sessions/${encodeURIComponent(sessionRef.current.id)}/end`);
      }
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      active = false;
      mountedRef.current = false;
      window.removeEventListener("pagehide", onPageHide);
      closeAudio(true);
      const endingSessionId = sessionRef.current?.id;
      const pendingSession = sessionPromiseRef.current;
      endTimerRef.current = window.setTimeout(() => {
        if (mountedRef.current) return;
        if (endingSessionId) void endVoiceSession(endingSessionId).catch(() => undefined);
        else void pendingSession?.then((opened) => endVoiceSession(opened.id)).catch(() => undefined);
      }, 200);
    };
  // The cleanup closes browser resources belonging to this mounted route.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, initialSessionId]);

  useEffect(() => {
    let active = true;
    void navigator.mediaDevices?.enumerateDevices().then((devices) => {
      if (active) setMicrophones(devices.filter((device) => device.kind === "audioinput"));
    }).catch(() => undefined);
    const onDeviceChange = () => { void refreshMicrophones(); };
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
    return () => {
      active = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
    };
  }, [refreshMicrophones]);

  const level = ui.state === "speaking" ? outputLevel : ui.state === "listening" || ui.state === "wake_detected" ? inputLevel : 0;
  const statusText = ui.state === "idle" && mode === "live" ? "Pronta para ouvir" : stateLabels[ui.state];

  return (
    <main className="relative h-dvh overflow-y-auto bg-[radial-gradient(circle_at_50%_40%,#dce3ff_0%,#f5f6fb_45%,#f7f4fd_100%)] px-4 py-5 sm:px-8">
      <div className="mx-auto flex min-h-full max-w-5xl flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <Link className="inline-flex items-center gap-2 rounded-xl bg-white/75 px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-white" href={`/chat/${encodeURIComponent(conversationId)}`}>
            <ArrowLeft className="size-4" /> Voltar para conversa
          </Link>
          <div className="flex items-center gap-2">
            <Link className="inline-flex items-center gap-2 rounded-xl bg-white/70 px-3 py-2.5 text-xs font-medium text-slate-600 transition hover:bg-white" href={`/observability?conversation=${encodeURIComponent(conversationId)}&view=voice`}><Activity className="size-4" /> Observabilidade</Link>
            <Link className="inline-flex items-center gap-2 rounded-xl bg-white/70 px-3 py-2.5 text-xs font-medium text-slate-600 transition hover:bg-white" href="/settings#voice"><Settings2 className="size-4" /> Configurações</Link>
          </div>
        </header>

        <section className="flex flex-1 flex-col items-center justify-center py-8 text-center">
          <p className="max-w-lg truncate text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-600">{conversationTitle}</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">Luna</h1>
          <p className="mt-2 text-sm text-slate-500">{mode === "wake" ? "Wake mode · diga “Luna”" : "Live mode · conversa contínua"}</p>
          {mode === "wake" ? <WakeModelStatusBadge className="mt-1" /> : null}

          <div className="relative my-8 flex size-[min(68vw,19rem)] items-center justify-center">
            <div className="absolute inset-0 rounded-full border border-indigo-200/80 bg-white/25 shadow-[0_35px_90px_rgba(68,74,144,0.15)] transition-transform duration-75" style={{ transform: `scale(${1 + level * 0.22})` }} />
            <div className="absolute inset-[10%] rounded-full border border-indigo-200/70 bg-indigo-100/60 transition-transform duration-75" style={{ transform: `scale(${1 + level * 0.16})` }} />
            <div className={`relative flex size-[70%] items-center justify-center rounded-full text-white shadow-[0_24px_50px_rgba(56,64,127,0.28)] transition-colors duration-300 ${ui.state === "error" ? "bg-rose-500" : ui.state === "speaking" ? "bg-violet-600" : ui.state === "listening" ? "bg-indigo-600" : "bg-slate-900"}`} style={{ transform: `scale(${1 + level * 0.08})` }}>
              {ui.state === "error" ? <CircleAlert className="size-16" strokeWidth={1.3} /> : ui.state === "speaking" ? <AudioLines className="size-16" strokeWidth={1.3} /> : <Mic2 className="size-16" strokeWidth={1.3} />}
            </div>
          </div>

          <div aria-live="polite" className="min-h-16">
            <p className="text-lg font-semibold text-slate-900">{statusText}</p>
            <p className="mt-1 text-xs text-slate-500">{ui.connected ? `Sessão conectada · ${mode === "wake" ? "wake leve ativo" : "escuta contínua"}` : "Microfone desligado"}</p>
          </div>

          {ui.error ? <p role="alert" className="mt-3 max-w-xl rounded-xl border border-rose-200 bg-rose-50/90 px-4 py-2 text-sm text-rose-700">{ui.error}</p> : null}

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <div className="inline-flex rounded-2xl border border-white/90 bg-white/60 p-1 shadow-sm" role="group" aria-label="Modo de voz">
              <button aria-pressed={mode === "wake"} className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition ${mode === "wake" ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-900"}`} disabled={!session || starting || switching || microphoneBusy} onClick={() => void changeMode("wake")} type="button">Wake</button>
              <button aria-pressed={mode === "live"} className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition ${mode === "live" ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-900"}`} disabled={!session || starting || switching || microphoneBusy} onClick={() => void changeMode("live")} type="button">Live</button>
            </div>
            {ui.connected ? (
              <button className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-700" onClick={() => closeAudio()} type="button"><MicOff className="size-4" /> Desligar microfone</button>
            ) : (
              <button className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50" disabled={!session || starting || switching || microphoneBusy || settings?.voiceEnabled === false} onClick={() => session && void connectAudio(session, mode)} type="button">{starting || microphoneBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Mic2 className="size-4" />} {starting || microphoneBusy ? "Conectando" : "Ativar microfone"}</button>
            )}
            {ui.connected && ui.state === "listening" ? <button className="inline-flex items-center gap-2 rounded-xl border border-white/90 bg-white/70 px-4 py-3 text-sm font-semibold text-slate-700" onClick={finalizeUtterance} type="button"><Square className="size-3.5" /> Concluir fala</button> : null}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500">
            <Mic2 className="size-4" />
            <label htmlFor="voice-microphone">Microfone</label>
            <select className="max-w-[min(72vw,22rem)] rounded-lg border border-white/80 bg-white/75 px-2 py-1.5 text-xs text-slate-700 outline-none" disabled={starting || switching || microphoneBusy} id="voice-microphone" onChange={(event) => void selectMicrophone(event.target.value)} value={microphoneId}>
              <option value="">Padrão do sistema</option>
              {microphoneId && !microphones.some((device) => device.deviceId === microphoneId) ? <option value={microphoneId}>Microfone salvo indisponível</option> : null}
              {microphones.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microfone ${index + 1} (autorize o acesso para identificar)`}</option>)}
            </select>
            <button aria-label="Atualizar lista de microfones" className="rounded-md p-1.5 text-indigo-600 hover:bg-indigo-50" onClick={() => void refreshMicrophones()} title="Atualizar microfones" type="button"><RefreshCw className="size-3.5" /></button>
            <span aria-live="polite">{activeMicrophoneLabel ? `Em uso: ${activeMicrophoneLabel}` : microphones.some((device) => !device.label) ? "Autorize o microfone para mostrar os nomes." : "A troca será aplicada ao conectar."}</span>
          </div>

          <div className="mt-5 flex items-center gap-2 text-xs text-slate-500">
            <Headphones className="size-4" />
            <label htmlFor="voice-profile">Voz</label>
            <select className="rounded-lg border border-white/80 bg-white/75 px-2 py-1.5 text-xs text-slate-700 outline-none" id="voice-profile" onChange={(event) => void changeVoice(event.target.value)} value={selectedProfileId ?? ""}>
              {profiles.length === 0 ? <option value="">Nenhuma voz disponível</option> : null}
              {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
            </select>
          </div>
        </section>

        <footer className="grid gap-3 pb-2 md:grid-cols-2">
          <section className="rounded-2xl border border-white/80 bg-white/55 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-indigo-600">Última interação</p>
            <p className="mt-2 min-h-5 text-sm text-slate-700">{ui.transcript ? `Você: ${ui.transcript}` : "Sua fala aparecerá aqui após a transcrição."}</p>
            {ui.response ? <p className="mt-2 text-sm text-slate-900">Luna: {ui.response}</p> : null}
          </section>
          <section className="rounded-2xl border border-white/80 bg-white/55 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-indigo-600">Eventos da sessão</p>
            <div className="mt-2 max-h-28 space-y-1 overflow-y-auto text-xs text-slate-600" aria-live="polite">
              {events.length ? events.map((event, index) => <p key={`${event.at}-${index}`}><span className="mr-2 font-mono text-slate-400">{event.at}</span>{event.label}</p>) : "A sessão aparecerá aqui quando o microfone for ativado."}
            </div>
            {session ? <p className="mt-2 truncate font-mono text-[10px] text-slate-400">Conversation {conversationId} · VoiceSession {session.id}</p> : null}
          </section>
        </footer>
      </div>
    </main>
  );
}
