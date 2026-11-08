import { requestJson } from "./conversation-api";

export interface PersonalityDraft {
  name: string;
  instructions: string;
  tone: string;
  detail: string;
  humor: string;
}

export interface PersonalityPreset extends PersonalityDraft {
  id: string;
  builtIn: boolean;
  revision: number;
}

export interface Personalities {
  activeId: string;
  presets: PersonalityPreset[];
}

interface PreviewAnswer {
  name: string;
  text: string;
  model: string;
}

export interface PersonalityPreview {
  active: PreviewAnswer;
  draft: PreviewAnswer;
}

const endpoint = "/api/personality";

function send<T>(path: string, method: "POST" | "PATCH", body?: unknown) {
  return requestJson<T>(endpoint + path, {
    method,
    ...(body === undefined ? {} : {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
}

export const getPersonalities = () => requestJson<Personalities>(endpoint, { cache: "no-store" });

export function savePersonality(draft: PersonalityDraft, preset?: PersonalityPreset) {
  return preset
    ? send<PersonalityPreset>("/" + encodeURIComponent(preset.id), "PATCH", { ...draft, revision: preset.revision })
    : send<PersonalityPreset>("", "POST", draft);
}

export function activatePersonality(id: string) {
  return send<{ activeId: string }>("/" + encodeURIComponent(id) + "/activate", "POST");
}

export function previewPersonality(input: string, draft: PersonalityDraft) {
  return send<PersonalityPreview>("/preview", "POST", { input, draft });
}
