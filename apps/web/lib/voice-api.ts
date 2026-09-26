export type VoiceMode = "wake" | "live";
export type VoiceState = "idle" | "wake_detected" | "listening" | "transcribing" | "thinking" | "speaking" | "error";

export interface VoiceSession {
  id: string;
  conversationId: string;
  mode: VoiceMode;
  startedAt: string;
  endedAt: string | null;
  state?: VoiceState;
}

export interface VoiceProfile {
  id: string;
  name: string;
  voiceId: string;
  language: string | null;
  source: string;
  sourceUrl?: string | null;
  license?: string | null;
}

export interface VoiceProfilesResponse {
  profiles: VoiceProfile[];
  selectedProfileId: string | null;
}

export interface VoiceEvent {
  id: string;
  type: string;
  createdAt: string;
  data: Record<string, unknown>;
}

export type WakeRecordingCategory = "positive" | "negative" | "background";
export interface WakeRecordingStats {
  positive: number;
  negative: number;
  background: number;
  backgroundDurationSeconds?: number;
}

export interface WakeModelStatus {
  modelReady: boolean;
  model: string;
  validationState: "unvalidated" | "provisional" | "validated";
  error: string | null;
}

export function getWakeModelStatus(): Promise<WakeModelStatus> {
  return voiceJson<WakeModelStatus>("/api/voice/wake/status");
}

export function voiceWebSocketUrl(sessionId: string): string {
  const configured = process.env.NEXT_PUBLIC_VOICE_WS_URL;
  const base = configured
    ? new URL(configured, window.location.href)
    : new URL(`${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:8000/voice/ws`);
  base.searchParams.set("sessionId", sessionId);
  return base.toString();
}

export function createVoiceSession(input: { conversationId?: string; mode: VoiceMode }): Promise<VoiceSession> {
  return voiceJson<VoiceSession>("/api/voice/sessions", { method: "POST", body: JSON.stringify(input) });
}

export function getVoiceSession(id: string): Promise<VoiceSession> {
  return voiceJson<VoiceSession>(`/api/voice/sessions/${encodeURIComponent(id)}`);
}

export function endVoiceSession(id: string): Promise<VoiceSession> {
  return voiceJson<VoiceSession>(`/api/voice/sessions/${encodeURIComponent(id)}/end`, { method: "POST" });
}

export function getVoiceSessions(conversationId: string): Promise<VoiceSession[]> {
  return voiceJson<VoiceSession[]>(`/api/voice/sessions?conversationId=${encodeURIComponent(conversationId)}`);
}

export function getVoiceSessionEvents(id: string): Promise<{ session: VoiceSession; events: VoiceEvent[] }> {
  return voiceJson<{ session: VoiceSession; events: VoiceEvent[] }>(`/api/voice/sessions/${encodeURIComponent(id)}/events`);
}

export function getVoiceProfiles(): Promise<VoiceProfilesResponse> {
  return voiceJson<VoiceProfilesResponse>("/api/voice/profiles");
}

export function importVoiceProfile(input: { name: string; url: string; license?: string; voiceId?: string }): Promise<VoiceProfile> {
  return voiceJson<VoiceProfile>("/api/voice/profiles/import", { method: "POST", body: JSON.stringify(input) });
}

export async function uploadVoiceProfile(input: { file: File; name: string; license?: string; voiceId?: string }): Promise<VoiceProfile> {
  const form = new FormData();
  form.append("file", input.file);
  form.append("name", input.name);
  if (input.license) form.append("license", input.license);
  if (input.voiceId) form.append("voiceId", input.voiceId);
  const response = await fetch("/api/voice/profiles/upload", { method: "POST", body: form });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string" ? payload.message : `Não foi possível enviar o voice pack (${response.status}).`;
    throw new Error(message);
  }
  return payload as VoiceProfile;
}

export function selectVoiceProfile(id: string): Promise<VoiceProfile> {
  return voiceJson<VoiceProfile>(`/api/voice/profiles/${encodeURIComponent(id)}/select`, { method: "POST" });
}

export function deleteVoiceProfile(id: string): Promise<void> {
  return voiceJson<void>(`/api/voice/profiles/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function voiceProfilePreviewUrl(id: string): string {
  return `/api/voice/profiles/${encodeURIComponent(id)}/preview`;
}

export function getWakeRecordingStats(): Promise<WakeRecordingStats> {
  return voiceJson<WakeRecordingStats>("/api/voice/training/recordings/stats");
}

export async function uploadWakeRecording(category: WakeRecordingCategory, recording: Blob, durationSeconds: number): Promise<void> {
  const form = new FormData();
  form.append("file", recording, `${category}-${new Date().toISOString().replace(/[:.]/gu, "-")}.webm`);
  form.append("durationSeconds", durationSeconds.toFixed(2));
  const response = await fetch(`/api/voice/training/recordings?category=${category}`, { method: "POST", body: form });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => undefined);
    const message = payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string" ? payload.message : `Não foi possível salvar a gravação (${response.status}).`;
    throw new Error(message);
  }
}

async function voiceJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (response.status === 204) return undefined as T;
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    let detail = `Serviço de voz indisponível (${response.status}).`;
    if (payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string") detail = payload.message;
    throw new Error(detail);
  }
  return payload as T;
}
