import { requestJson } from "./conversation-api";

export type DiscordVoiceSettings = {
  enabled: boolean;
  guildId: string | null;
  channelId: string | null;
  status: {
    state: "offline" | "missing_token" | "disabled" | "connecting" | "ready" | "in_channel" | "error";
    updatedAt: string | null;
  };
  destinations: Array<{
    id: string;
    name: string;
    channels: Array<{ id: string; name: string }>;
  }>;
};

type DiscordVoiceUpdate = Partial<Pick<DiscordVoiceSettings, "enabled" | "guildId" | "channelId">>;

const endpoint = "/api/discord-voice";

export function getDiscordVoice(signal?: AbortSignal) {
  return requestJson<DiscordVoiceSettings>(endpoint, { cache: "no-store", signal });
}

export function updateDiscordVoice(update: DiscordVoiceUpdate) {
  return requestJson<DiscordVoiceSettings>(endpoint, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
}

