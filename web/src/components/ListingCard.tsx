import { useEffect, useState } from "react";
import { api } from "../api";
import type { Listing, Status } from "../types";
import Lightbox from "./Lightbox";
import { Icon, Sheet } from "./ui";

export type View = "full" | "short";

const fmt = (n: number | null | undefined) => (n == null ? "?" : Math.round(n).toLocaleString("pl-PL"));
const AUTHOR: Record<string, string> = { private: "private owner", agency: "agency", developer: "developer" };

function when(d: string | null): string | null {
  if (!d) return null;
  const t = Date.parse(d);
  if (Number.isNaN(t)) return d;
  if (t <= Date.now()) return "available now";
  return "from " + new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

const fullDate = (t: number) => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** "today 14:05", "yesterday", "4d ago", then "3 Nov" (plus the year if it isn't this year) */
function ago(d: string | null): string | null {
  const t = d ? Date.parse(d) : NaN;
  if (Number.isNaN(t)) return null;
  const day = (x: number) => { const v = new Date(x); v.setHours(0, 0, 0, 0); return v.getTime(); };
  const days = Math.round((day(Date.now()) - day(t)) / 864e5);
  if (days <= 0) return "today " + new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  const sameYear = new Date(t).getFullYear() === new Date().getFullYear();
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

/** One listing: score, title, price, where, AI teaser, and the same five actions on every card. */
export default function ListingCard({ l, tags, onStatus, onNote, view = "short", stub = false }: {
  l: Listing;
  tags: Record<string, string>;
  onStatus: (uid: string, s: Status) => void;
  onNote?: (uid: string, note: string) => void;
  /** short: AI summary folded to a 2-line teaser; full: open */
  view?: View;
  /** just rejected: show a one-line stub with Restore */
  stub?: boolean;
}) {
  const [aiOpen, setAiOpen] = useState<boolean | null>(null);
  useEffect(() => setAiOpen(null), [view]);
  const showAi = aiOpen ?? view === "full";

  const [note, setNote] = useState(l.note || "");
  useEffect(() => setNote(l.note || ""), [l.note]);
  const [draft, setDraft] = useState<string | null>(null);
  const [noteErr, setNoteErr] = useState("");
  const saveNote = async () => {
    if (draft === null) return;
    setNoteErr("");
    try {
      const r = await api.setNote(l.uid, draft.trim());
      setNote(r.note); setDraft(null); onNote?.(l.uid, r.note);
    } catch (e) {
      setNoteErr(e instanceof Error ? e.message : String(e));
    }
  };

  const [desc, setDesc] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<"" | "desc" | "photos">("");
  const [showDesc, setShowDesc] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  const [copied, setCopied] = useState(false);

  const toggleDesc = async () => {
    if (!showDesc && desc === null) {
      setBusy("desc");
      try { setDesc((await api.detail(l.uid)).description || "(no description)"); }
      catch (e) { setDesc(`Could not load: ${e}`); }
      setBusy("");
    }
    setShowDesc(s => !s);
  };
  const togglePhotos = async () => {
    if (!showPhotos && photos === null) {
      setBusy("photos");
      try { setPhotos(await api.images(l.uid)); } catch { setPhotos([]); }
      setBusy("");
    }
    setShowPhotos(s => !s);
  };

  const s = l.ai_score;
  const fav = l.status === "favorite";
  const rejected = l.status === "rejected";
  const place = [l.location.street, l.location.district].filter(Boolean).join(", ") || l.location.city || "";
  const loc = [l.location.street, l.location.district, l.location.city].filter(Boolean).join(", ");
  const { lat, lon } = l.location;
  const mapQuery = lat != null && lon != null ? `${lat},${lon}` : loc;
  const mapUrl = mapQuery ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}` : null;
  const site = l.source === "olx" ? "OLX" : "Otodom";
  // when the ad was posted on the site; falls back to when rentme first saw it
  const added = ago(l.created_at) ?? ago(l.first_seen);
  const dates = [
    l.created_at && !Number.isNaN(Date.parse(l.created_at)) ? `Posted on ${site} ${fullDate(Date.parse(l.created_at))}` : null,
    `Found by rentme ${fullDate(Date.parse(l.first_seen))}`,
  ].filter((x): x is string => !!x);

  if (stub) {
    return (
      <div className="stub">
        <span>Rejected · {l.title}</span>
        <button className="btn ghost sm" onClick={() => onStatus(l.uid, "seen")}>Restore</button>
      </div>
    );
  }

  const ppm = l.total_price && l.area_m2 ? l.total_price / l.area_m2 : null;
  const lineLoc = [place, l.author_type ? AUTHOR[l.author_type] || l.author_type : null, when(l.available_from)].filter(Boolean).join(" · ");
  const ai = l.ai;

  return (
    <article className={`card ${fav ? "favorite" : ""} ${rejected ? "rejected" : ""}`}>
      <div className="main">
        <div className={"score" + (s == null ? " none" : s < 50 ? " low" : s >= 80 ? " high" : "")}>
          {s ?? <span>not<br />ranked</span>}
          {fav && <span className="fav"><Icon name="star" size={14} filled /></span>}
        </div>
        <div className="body">
          <a className="title" href={l.url} target="_blank" rel="noreferrer">{l.title}</a>
          <div className="badges">
            <span className="badge">{site}</span>
            {l.status === "new" && <span className="badge new">New</span>}
            {!l.active && <span className="badge">Gone</span>}
            {l.added_by_link && <span className="badge" title="You added this one by its link">Added</span>}
            {added && <span className="posted" title={dates.join("\n")}>{added}</span>}
          </div>
          <div className="price">
            {fmt(l.total_price)} zł{" "}
            {l.admin_fee ? <span>{fmt(l.price)} + {fmt(l.admin_fee)} czynsz</span> : null}
          </div>
          <div className="facts">
            <b>{l.area_m2 ?? "?"} m²</b> · <b>{l.rooms ?? "?"} {l.rooms === 1 ? "room" : "rooms"}</b>
            {ppm ? <> · {fmt(ppm)} zł/m²</> : null}
            {l.deposit ? <> · deposit {fmt(l.deposit)}</> : null}
          </div>
          {lineLoc && <div className="loc">{lineLoc}</div>}
          {l.filter_ok === 0 && <div className="filtered">Filtered out: {l.filter_reason}</div>}
        </div>
      </div>

      {(note || draft !== null || ai || (showAi && l.tags.length > 0) || showDesc) && (
        <div className="extra">
          {note && draft === null && (
            <button className="note" onClick={() => setDraft(note)} title="Edit note"><Icon name="note" size={15} />{note}</button>
          )}
          {draft !== null && (
            <div className="noteEdit">
              <textarea className="input" autoFocus rows={3} value={draft}
                placeholder="Viewing date, what the landlord said… The AI search sees it too."
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveNote(); }
                  if (e.key === "Escape") setDraft(null);
                }} />
              <div className="row">
                <button className="btn sm primary" onClick={saveNote}>Save note</button>
                <button className="btn sm" onClick={() => setDraft(null)}>Cancel</button>
                {note && <button className="btn sm ghost danger" onClick={() => setDraft("")}>Clear</button>}
                {noteErr && <span className="err small">{noteErr}</span>}
              </div>
            </div>
          )}
          {ai && (
            <div className={"ai" + (showAi ? " open" : "")}>
              <button className="aiToggle" aria-expanded={showAi} onClick={() => setAiOpen(!showAi)}>
                <span>{ai.summary}</span><Icon name="down" size={16} />
              </button>
              {showAi && <>
                {ai.pros.length > 0 && <ul className="pc pros">{ai.pros.map((p, i) => <li key={i}>{p}</li>)}</ul>}
                {ai.cons.length > 0 && <ul className="pc cons">{ai.cons.map((p, i) => <li key={i}>{p}</li>)}</ul>}
                {ai.red_flags.length > 0 && <div className="flag">Red flag: {ai.red_flags.join(" · ")}</div>}
              </>}
            </div>
          )}
          {showAi && l.tags.length > 0 && (
            <div className="tags">{l.tags.map(t => <span key={t} className="tag">{tags[t] || t}</span>)}</div>
          )}
          {showDesc && desc !== null && <div className="desc">{desc}</div>}
        </div>
      )}

      {showPhotos && photos !== null && (
        <div className="photos" ref={el => { if (el && !el.dataset.init) { el.dataset.init = "1"; el.scrollLeft = 0; } }}>
          {photos.length === 0 && <span className="muted small">No photos</span>}
          {photos.map((u, i) => (
            <button key={u} className="thumb" onClick={() => setViewer(i)} aria-label={`Photo ${i + 1}`}>
              <img src={u} loading="lazy" referrerPolicy="no-referrer" alt="" />
            </button>
          ))}
        </div>
      )}

      <nav className="actions">
        <button className={"action" + (showPhotos ? " on" : "")} onClick={togglePhotos} disabled={busy === "photos"} aria-pressed={showPhotos}>
          {busy === "photos" ? <span className="spin" /> : <Icon name="photos" />}
          {showPhotos ? "Hide" : `Photos${l.image_count ? ` ${l.image_count}` : ""}`}
        </button>
        {mapUrl
          ? <a className="action" href={mapUrl} target="_blank" rel="noreferrer"
              title={lat != null && lon != null ? "Exact location from the listing" : `Search: ${loc}`}><Icon name="map" />Map</a>
          : <button className="action" disabled><Icon name="map" />Map</button>}
        <button className={"action" + (fav ? " fav" : "")} aria-pressed={fav} onClick={() => onStatus(l.uid, fav ? "seen" : "favorite")}>
          <Icon name="star" filled={fav} />{fav ? "Saved" : "Favorite"}
        </button>
        <button className="action" onClick={() => onStatus(l.uid, rejected ? "seen" : "rejected")}>
          <Icon name={rejected ? "undo" : "x"} />{rejected ? "Restore" : "Reject"}
        </button>
        <button className="action" onClick={() => setMore(true)}><Icon name="more" />More</button>
      </nav>

      {more && (
        <Sheet title={l.title} onClose={() => setMore(false)}>
          <div className="sheetMeta">{dates.map(d => <span key={d}>{d}</span>)}</div>
          <button className="item" onClick={() => { setMore(false); toggleDesc(); }} disabled={busy === "desc"}>
            <Icon name="text" />{busy === "desc" ? "Loading…" : showDesc ? "Hide description" : "Description"}
          </button>
          <button className="item" onClick={() => { setMore(false); setDraft(note); }}>
            <Icon name="note" />{note ? "Edit note" : "Add note"}
          </button>
          {l.status === "new" && (
            <button className="item" onClick={() => { setMore(false); onStatus(l.uid, "seen"); }}><Icon name="eye" />Mark seen</button>
          )}
          <div className="sep" />
          <a className="item" href={l.url} target="_blank" rel="noreferrer" onClick={() => setMore(false)}><Icon name="external" />Open on {site}</a>
          {navigator.clipboard && (
            <button className="item" onClick={() => navigator.clipboard.writeText(l.url).then(() => { setCopied(true); setTimeout(() => setMore(false), 600); })}>
              <Icon name="copy" />{copied ? "Copied" : "Copy link"}
            </button>
          )}
        </Sheet>
      )}

      {viewer !== null && photos && photos.length > 0 && (
        <Lightbox urls={photos} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} title={l.title} />
      )}
    </article>
  );
}
