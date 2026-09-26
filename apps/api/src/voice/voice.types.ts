export type VoiceMode = 'wake' | 'live';
export type VoiceState = 'idle' | 'wake_detected' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'error';

export interface SttProvider {
  readonly name: string;
  transcribe(pcm16: Buffer, signal?: AbortSignal): Promise<string>;
}

export interface TtsProvider {
  readonly name: string;
  synthesize(text: string, voiceId: string, speed: number, signal?: AbortSignal): Promise<{ audio: Buffer; mimeType: string }>;
  listVoices(): Promise<string[]>;
}

export interface WakeWordProvider {
  readonly name: string;
  detect(frame: Buffer, sessionId: string, threshold: number, verifier?: { enabled: boolean; model: string | null; threshold: number }): Promise<{ detected: boolean; score: number; model: string; timestamp: number }>;
  reset(sessionId: string, release?: boolean): Promise<void>;
}
