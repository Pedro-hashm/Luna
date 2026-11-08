import { requestJson } from "./conversation-api";

export type MemoryKind = "profile" | "preference" | "project" | "relationship" | "event";
export type MemoryDraft = {
  subject: string;
  predicate: string;
  scope: string;
  kind: MemoryKind;
  value: string;
  validFrom: string | null;
  operation: "add" | "change" | "correct";
};
export type MemorySettings = { enabled: boolean; suggestionsEnabled: boolean; allowExplicitUse: boolean };
export type MemorySource = { id: string; quote: string; message: { conversationId: string; createdAt: string } };
export type MemoryRevision = {
  id: string; number: number; value: string; validFrom: string | null; validTo: string | null;
  status: "active" | "historical" | "retracted"; recordedAt: string; sources?: MemorySource[];
};
export type MemoryItem = Pick<MemoryDraft, "subject" | "predicate" | "scope" | "kind"> & {
  id: string; version: number; allowModel: boolean; pinned: boolean; archived: boolean; revisions: MemoryRevision[];
};
export type MemorySuggestion = {
  id: string; draft: MemoryDraft; quote: string; createdAt: string;
  message: { conversationId: string; createdAt: string };
  existing: { id: string; version: number; value: string } | null;
};
export type MemoryDashboard = {
  settings: MemorySettings; items: MemoryItem[]; suggestions: MemorySuggestion[];
  queue: { pending: number; failed: number };
};

const root = "/api/memory";
const itemPath = (id: string) => "/items/" + encodeURIComponent(id);
const suggestionPath = (id: string) => "/suggestions/" + encodeURIComponent(id);
function send<T>(path: string, method: string, body?: unknown) {
  return requestJson<T>(root + path, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
}

export const listMemories = () => requestJson<MemoryDashboard>(root, { cache: "no-store" });
export const readMemory = (id: string) => requestJson<MemoryItem>(root + itemPath(id), { cache: "no-store" });
export const readMemoryMap = (subject: string, date: string) =>
  requestJson<MemoryItem[]>(root + "/map?" + new URLSearchParams({ subject, date }), { cache: "no-store" });
export const configureMemory = (settings: Partial<MemorySettings>) => send<MemorySettings>("/settings", "PATCH", settings);
export const reviewMemory = () => send<{ examined: number; proposed: number }>("/review", "POST");
export const saveMemory = (body: object, id?: string) => send<{ id: string }>(id ? itemPath(id) : "/items", id ? "PATCH" : "POST", body);
export const forgetMemory = (item: MemoryItem) => send(itemPath(item.id) + "?version=" + item.version, "DELETE");
export const approveMemory = (id: string, body: object) => send<{ id: string }>(suggestionPath(id) + "/approve", "POST", body);
export const dismissMemory = (id: string) => send(suggestionPath(id), "DELETE");
