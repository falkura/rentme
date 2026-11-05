import type { ChatMsg, ChatReply, FilterChange, KeyStatus, SavedChat, Listing, Meta, SearchSettings, Settings, Status } from "./types";

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || data.detail || `HTTP ${r.status}`);
  return data as T;
}

const body = (x: unknown) => JSON.stringify(x);

export const api = {
  meta: () => req<Meta>("/api/meta"),
  settings: () => req<{ config: Settings; api_key: KeyStatus }>("/api/settings"),
  saveSettings: (config: Settings) =>
    req<{ ok: boolean; refiltered: number; config: Settings }>("/api/settings", { method: "PUT", body: body(config) }),
  setKey: (key: string) => req<KeyStatus>("/api/settings/api-key", { method: "PUT", body: body({ key }) }),
  testKey: () => req<{ ok: boolean; error?: string }>("/api/settings/test-key", { method: "POST" }),

  listings: (includeFiltered: boolean) => req<Listing[]>(`/api/listings?include_filtered=${includeFiltered}`),
  listingsByUid: (uids: string[]) => req<Listing[]>(`/api/listings?uids=${encodeURIComponent(uids.join(","))}`),
  detail: (uid: string) => req<{ description: string | null }>(`/api/listings/${encodeURIComponent(uid)}`),
  images: (uid: string) => req<string[]>(`/api/listings/${encodeURIComponent(uid)}/images`),
  setStatus: (uid: string, status: Status) =>
    req(`/api/listings/${encodeURIComponent(uid)}/status`, { method: "POST", body: body({ status }) }),

  setNote: (uid: string, note: string) =>
    req<{ ok: boolean; note: string }>(`/api/listings/${encodeURIComponent(uid)}/note`, { method: "PUT", body: body({ note }) }),
  byUrl: (url: string) =>
    req<{ found: "existing" | "added"; listing: Listing }>("/api/listings/by-url", { method: "POST", body: body({ url }) }),

  rescoreNewCount: () => req<{ count: number; without_details: number; model: string }>("/api/rescore-new"),
  rescoreNew: () => req<{ started: boolean }>("/api/rescore-new", { method: "POST" }),
  startUpdate: (ai = true, scrape = true) =>
    req<{ started: boolean }>(`/api/update?ai=${ai}&scrape=${scrape}`, { method: "POST" }),
  olxUrls: () => req<{ urls: string[] }>("/api/olx/urls"),
  olxImport: (data: unknown) => req<{ offers: number; imported: number; otodom_mirrors_skipped: number; new: number; passing_filters: number }>(
    "/api/olx/import", { method: "POST", body: body(data) }),
  updateStatus: () => req<{ running: boolean; stopping: boolean; log: string[] }>("/api/update"),
  stopUpdate: () => req<{ stopping: boolean }>("/api/update/stop", { method: "POST" }),

  chat: (message: string, session_id: string | null) =>
    req<ChatReply>("/api/chat", { method: "POST", body: body({ message, session_id }) }),
  resetChat: (session_id: string) => req(`/api/chat/${session_id}`, { method: "DELETE" }),
  chatHistory: (session_id: string) =>
    req<{ session_id: string; messages: ChatMsg[]; title: string | null; saved: boolean }>(`/api/chat/${session_id}`),
  savedChats: () => req<SavedChat[]>("/api/chats"),
  saveChat: (session_id: string, title: string | null, saved = true) =>
    req<{ id: string; title: string; saved: boolean }>(`/api/chat/${session_id}/save`, { method: "PUT", body: body({ title, saved }) }),
  saveMemory: (memory: string[]) => api.patchAi({ memory }),
  patchAi: async (patch: Partial<Settings["ai"]>) => {
    const { config } = await api.settings();
    return api.saveSettings({ ...config, ai: { ...config.ai, ...patch } });
  },
  filterAction: (session_id: string, change_id: string, action: "apply" | "dismiss" | "undo") =>
    req<{ change: FilterChange; passing: number | null; search: SearchSettings }>(
      `/api/chat/${session_id}/filters/${change_id}`, { method: "POST", body: body({ action }) }),
};
