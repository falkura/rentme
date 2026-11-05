import { useState } from "react";
import type { FilterChange } from "../types";
import { Icon, requestUpdate } from "./ui";

const LABEL: Record<string, string> = {
  city: "City", price_min: "Min price", price_max: "Max price", area_min: "Min area", area_max: "Max area",
  rooms: "Rooms", private_only: "Private owners only", required_tags: "Required tags",
  excluded_tags: "Excluded tags", exclude_keywords: "Excluded words", excluded_districts: "Excluded districts",
  "ai.model": "AI model", "ai.effort": "Ranking effort", "ai.chat_effort": "Chat effort", "ai.enabled": "Rank on update",
  "ai.batch_size": "Listings per AI request", "ai.max_per_run": "Max ranked per update", "ai.preferences": "What you want",
  "sources.otodom": "Otodom", "sources.olx": "OLX (automatic)", "sources.otodom_location": "Otodom location",
  "scrape.delay": "Delay between requests (s)", "scrape.max_details_per_run": "Max detail pages per update",
  "search.max_pages": "Pages per source",
};
const isFilter = (k: string) => !k.includes(".") || k.startsWith("search.");

function fmt(field: string, v: unknown, tags: Record<string, string>): string {
  if (v === null || v === undefined) return "any";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) {
    if (!v.length) return field === "rooms" ? "any" : "none";
    if (field === "rooms") return v.map(r => (r === 4 ? "4+" : String(r))).join(", ");
    if (field.endsWith("_tags")) return v.map(t => tags[t as string] || t).join(", ");
    return v.join(", ");
  }
  if (typeof v === "string" && v.length > 140) return v.slice(0, 137) + "…";
  if (field.startsWith("price")) return `${Number(v).toLocaleString("pl-PL")} zł`;
  if (field.startsWith("area")) return `${v} m²`;
  return String(v);
}

const HEAD: Record<FilterChange["state"], [string, string]> = {
  pending: ["Suggested", "sliders"], applied: ["Changed", "check"], dismissed: ["Dismissed", "x"], undone: ["Undone", "undo"],
};

/** A settings change made or suggested by the chat: field, old → new, and two equal buttons. */
export default function FilterChangeCard({ change, tags, onAction }: {
  change: FilterChange; tags: Record<string, string>;
  onAction: (a: "apply" | "dismiss" | "undo") => Promise<number | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [updating, setUpdating] = useState(false);

  const act = async (a: "apply" | "dismiss" | "undo") => {
    setBusy(true); setNote("");
    try {
      const passing = await onAction(a);
      if (passing !== null) setNote(`${passing} stored listings match now.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const s = change.state;
  const [head, icon] = HEAD[s];
  const filterChange = Object.keys(change.changes).some(isFilter);
  return (
    <div className={`change ${s}`}>
      <div className="chead"><Icon name={icon} size={16} />{head}</div>
      <ul>
        {Object.entries(change.changes).map(([k, [from, to]]) => (
          <li key={k}>
            <span className="field-name">{LABEL[k] || k}</span>
            <span className="val">
              {s === "undone" || s === "dismissed" ? fmt(k, from, tags) : <><s>{fmt(k, from, tags)}</s> → <b>{fmt(k, to, tags)}</b></>}
            </span>
          </li>
        ))}
      </ul>
      {s === "pending" && (
        <div className="two">
          <button className="btn sm" disabled={busy} onClick={() => act("dismiss")}>Dismiss</button>
          <button className="btn sm primary" disabled={busy} onClick={() => act("apply")}>Apply</button>
        </div>
      )}
      {s === "applied" && (
        <div className={filterChange ? "two" : ""}>
          <button className="btn sm" disabled={busy} onClick={() => act("undo")}>Undo</button>
          {filterChange && (
            <button className="btn sm primary" disabled={updating} onClick={() => { setUpdating(true); requestUpdate(); }}>
              {updating ? "Update started" : "Update now"}
            </button>
          )}
        </div>
      )}
      {(s === "dismissed" || s === "undone") && (
        <div><button className="btn sm" disabled={busy} onClick={() => act("apply")}>Apply anyway</button></div>
      )}
      {note && <span className="cnote">{note}</span>}
    </div>
  );
}
