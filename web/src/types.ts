export type Status = "new" | "seen" | "favorite" | "rejected";

export interface Location {
  city: string | null; district: string | null; street: string | null;
  region: string | null; lat: number | null; lon: number | null;
}

export interface AiEval {
  score: number; verdict: string; summary: string;
  pros: string[]; cons: string[]; red_flags: string[];
  pets_allowed: boolean | null; estimated_monthly_total_pln: number | null;
  available_from: string | null; min_lease_months: number | null;
}

export interface Listing {
  uid: string; source: "otodom" | "olx"; url: string; title: string;
  price: number | null; admin_fee: number | null; total_price: number | null; deposit: number | null;
  area_m2: number | null; rooms: number | null; floor: string | null;
  location: Location; author_name: string | null; author_type: string | null;
  tags: string[]; created_at: string | null; available_from: string | null;
  image_count: number; thumb: string | null; first_seen: string; active: boolean; status: Status;
  filter_ok: number | null; filter_reason: string | null; has_details: boolean;
  ai_score: number | null; ai: AiEval | null; duplicate_of: string | null;
  note: string; added_by_link: boolean;
}

export interface SearchSettings {
  city: string; price_min: number | null; price_max: number | null;
  area_min: number | null; area_max: number | null; rooms: number[];
  private_only: boolean; required_tags: string[]; excluded_tags: string[];
  exclude_keywords: string[]; excluded_districts: string[]; max_pages: number;
}

export interface Settings {
  search: SearchSettings;
  sources: { otodom: boolean; olx: boolean; otodom_location: string; olx_city_id: number };
  scrape: { db: string; delay: number; max_details_per_run: number };
  ai: {
    enabled: boolean; model: string; effort: string; chat_effort: string;
    batch_size: number; max_per_run: number; preferences: string; memory: string[];
    chat_can_edit_filters: boolean;
  };
}

export interface SavedChat { id: string; title: string; updated: string; messages: number }

export interface KeyStatus { set: boolean; source: string | null; hint: string | null }

export interface Meta {
  tags: Record<string, string>;
  cities: string[];
  models: { id: string; label: string }[];
}

export interface ChatReply {
  session_id: string; answer: string; listing_uids: string[];
  steps: { tool: string; input: Record<string, unknown> }[];
  filters?: FilterChange[];
  job_started?: boolean;
}

/** A change to the saved search filters proposed or made by the chat: field -> [old, new] */
export interface FilterChange {
  id: string; reason: string;
  changes: Record<string, [unknown, unknown]>;
  state: "pending" | "applied" | "dismissed" | "undone";
}

export interface ChatMsg {
  role: "user" | "assistant" | "error";
  text: string;
  uids?: string[];
  steps?: { tool: string; input: Record<string, unknown> }[];
  filters?: FilterChange[];
}
