"use client";

import { CircleStop, LoaderCircle, Mic2, Radio, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getWakeRecordingStats, uploadWakeRecording, type WakeRecordingCategory, type WakeRecordingStats } from "@/lib/voice-api";

const categories: Array<{ id: WakeRecordingCategory; title: string; description: string; maxSeconds: number }> = [
  { id: "positive", title: "Exemplo “Luna”", description: "Diga apenas Luna logo após clicar; gravação curta de até 3 s.", maxSeconds: 3 },
  { id: "negative", title: "Fala negativa", description: "Fale frases comuns ou sons parecidos com Luna.", maxSeconds: 120 },
  { id: "background", title: "Ambiente real", description: "Grave ruído, televisão, música ou conversa do ambiente.", maxSeconds: 1800 },
];
const preferredMicrophoneStorageKey = "luna.voice.microphoneDeviceId";

export function WakeTrainingSettings() {
  const [stats, setStats] = useState<WakeRecordingStats>();
  const [category, setCategory] = useState<WakeRecordingCategory>();
  const [uploading, setUploading] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const categoryRef = useRef<WakeRecordingCategory | undefined>(undefined);
  const mountedRef = useRef(false);

  async function refresh() {
    setStats(await getWakeRecordingStats());
    setError(undefined);
  }

  useEffect(() => {
    mountedRef.current = true;
    let active = true;
    void getWakeRecordingStats().then((result) => { if (active) setStats(result); }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Contagens indisponíveis."); });
    return () => {
      active = false;
      mountedRef.current = false;
      if (recorderRef.current) recorderRef.current.onstop = null;
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!category) return;
    const timer = window.setInterval(() => {
      const elapsed = Math.round((performance.now() - startedAtRef.current) / 1000);
      setSeconds(elapsed);
      const limit = categories.find((item) => item.id === category)?.maxSeconds ?? 15;
      if (elapsed >= limit && recorderRef.current?.state === "recording") recorderRef.current.stop();
    }, 500);
    return () => clearInterval(timer);
  }, [category]);

  async function start(nextCategory: WakeRecordingCategory) {
    if (category || uploading) return;
    setSaved(false);
    setError(undefined);
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError("Gravação indisponível neste navegador. Abra a página por HTTPS ou localhost em um navegador atualizado.");
      return;
    }
    const mimeType = ["audio/webm;codecs=opus", "audio/webm"].find((candidate) => MediaRecorder.isTypeSupported(candidate));
    if (!mimeType) { setError("Este navegador não grava WebM/Opus compatível com o pipeline de treinamento."); return; }
    try {
      let preferredMicrophoneId: string | null = null;
      try { preferredMicrophoneId = window.localStorage.getItem(preferredMicrophoneStorageKey); }
      catch { /* Use the system microphone if browser storage is unavailable. */ }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: {
        channelCount: 1,
        ...(preferredMicrophoneId ? { deviceId: { exact: preferredMicrophoneId } } : {}),
        echoCancellation: false,
        noiseSuppression: false,
      } });
      if (!mountedRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;
      chunksRef.current = [];
      categoryRef.current = nextCategory;
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32_000 });
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunksRef.current.push(event.data); };
      recorder.onstart = (event) => { startedAtRef.current = event.timeStamp; };
      recorder.onstop = (event) => {
        if (mountedRef.current) void saveRecording(mimeType, Math.max(0, (event.timeStamp - startedAtRef.current) / 1000));
      };
      recorder.onerror = () => setError("A gravação falhou. Verifique o microfone e tente novamente.");
      setSeconds(0);
      setCategory(nextCategory);
      recorder.start(1000);
    } catch (cause) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setError(cause instanceof Error ? cause.message : "Não foi possível acessar o microfone.");
    }
  }

  function stop() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  async function saveRecording(mimeType: string, durationSeconds: number) {
    const savedCategory = categoryRef.current;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setCategory(undefined);
    setUploading(true);
    try {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      if (!savedCategory || blob.size < 1000) throw new Error("Áudio vazio. Grave novamente por pelo menos um segundo.");
      await uploadWakeRecording(savedCategory, blob, durationSeconds);
      await refresh();
      setSaved(true);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar a gravação.");
    } finally {
      chunksRef.current = [];
      categoryRef.current = undefined;
      setUploading(false);
    }
  }

  return <section className="rounded-2xl border border-white/90 bg-white/55 p-4 sm:col-span-2">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Radio className="size-4 text-indigo-600" /> Treinamento da wake word</h3><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">Grave exemplos reais para treinar e avaliar o modelo customizado “Luna”. Os arquivos são salvos no dataset de treinamento, separado do runtime.</p></div><button aria-label="Atualizar contagens" className="rounded-lg p-2 text-indigo-600 hover:bg-indigo-50" onClick={() => void refresh().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Contagens indisponíveis."))} type="button"><RefreshCw className="size-4" /></button></div>
    <p className="mt-2 text-[11px] text-slate-500">As gravações usam o microfone selecionado na tela Voz; escolha o dispositivo antes de gravar.</p>
    <div className="mt-4 grid gap-2 sm:grid-cols-3">{categories.map((item) => <div className="rounded-xl border border-slate-100 bg-white/70 p-3" key={item.id}><p className="text-xs font-semibold text-slate-800">{item.title}</p><p className="mt-1 min-h-10 text-[11px] leading-4 text-slate-500">{item.description}</p><p className="mt-2 text-[11px] font-semibold text-indigo-700">{stats ? `${stats[item.id]} arquivo(s)` : "Carregando contagem"}</p>{item.id === "background" && typeof stats?.backgroundDurationSeconds === "number" ? <p className="mt-1 text-[11px] text-slate-500">{(stats.backgroundDurationSeconds / 60).toFixed(1)} min de ambiente real</p> : null}<button className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-2 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-40" disabled={Boolean(category) || uploading} onClick={() => void start(item.id)} type="button"><Mic2 className="size-3.5" /> Gravar</button></div>)}</div>
    {category ? <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-2"><span className="size-2 animate-pulse rounded-full bg-rose-500" /><p className="text-xs font-semibold text-rose-700">Gravando {categories.find((item) => item.id === category)?.title.toLowerCase()} · {seconds}s</p><button className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white" onClick={stop} type="button"><CircleStop className="size-3.5" /> Parar e salvar</button></div> : null}
    {uploading ? <p className="mt-3 flex items-center gap-2 text-xs text-indigo-700"><LoaderCircle className="size-3.5 animate-spin" /> Enviando gravação ao dataset</p> : null}
    {saved ? <p className="mt-3 text-xs font-medium text-emerald-700">Gravação salva. As contagens foram atualizadas.</p> : null}
    {error ? <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-xs text-rose-700">{error}</p> : null}
    <p className="mt-4 text-[11px] leading-5 text-slate-500">Após reunir exemplos, consulte <code className="rounded bg-white/80 px-1">tools/wakeword-training/README.md</code> para preparar dados, treinar e avaliar o modelo. Teste falsos despertares com gravações do seu ambiente antes de instalar o artefato.</p>
  </section>;
}
