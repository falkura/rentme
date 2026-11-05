import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { Listing, Meta, Status } from "../types";
import { PullIndicator, usePullToRefresh } from "./usePullToRefresh";
import ListingCard, { type View } from "./ListingCard";
import TagPicker, { type TagState } from "./TagPicker";
import { Choice, Icon, Sheet, Snackbar, Switch } from "./ui";

type Sort = "score" | "newest" | "price" | "ppm" | "area";
type StatusFilter = "active" | "new" | "favorite" | "notes" | "rejected" | "all";
type Source = "" | "otodom" | "olx";
type Lookup = { url: string; busy: boolean; error?: string; found?: "existing" | "added"; listing?: Listing };

const STATUS_LABEL: Record<StatusFilter, string> = {
  active: "Active", new: "New only", favorite: "Favorites", notes: "With notes", rejected: "Rejected", all: "All",
};
const SOURCE_LABEL: Record<Source, string> = { "": "All sites", otodom: "Otodom", olx: "OLX" };
const SORT_LABEL: Record<Sort, string> = { score: "Best", newest: "Newest", price: "Cheapest", ppm: "Cheapest per m²", area: "Largest" };

const DEFAULTS = {
  q: "", minScore: 0, maxPrice: "" as number | "", source: "" as Source, status: "active" as StatusFilter, sort: "score" as Sort,
  hideDup: true, showFiltered: false, tagState: {} as TagState,
};
type Saved = typeof DEFAULTS & { view: View };
const KEY = "rentme.listings.v1";
function loadSaved(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { ...DEFAULTS, view: "short", ...(s && typeof s === "object" ? s : {}) };
  } catch {
    return { ...DEFAULTS, view: "short" };
  }
}

/** A pasted offer link (otodom/olx) instead of search words */
const asUrl = (q: string) => (/^https?:\/\/\S*(otodom|olx)\.pl\/\S+$/i.test(q.trim()) ? q.trim() : null);

const matchesStatus = (l: Listing, s: StatusFilter) =>
  s === "all" ? true : s === "active" ? l.status !== "rejected" : s === "notes" ? !!l.note : l.status === s;

export default function Listings({ meta, reloadToken, onCounts, showNewest }: {
  meta: Meta; reloadToken: number; onCounts: (c: { fresh: number; total: number }) => void; showNewest: number;
}) {
  const [all, setAll] = useState<Listing[] | null>(null);
  const [init] = useState(loadSaved);
  const [q, setQ] = useState(init.q);
  const [minScore, setMinScore] = useState(init.minScore);
  const [maxPrice, setMaxPrice] = useState<number | "">(init.maxPrice);
  const [source, setSource] = useState<Source>(init.source);
  const [status, setStatus] = useState<StatusFilter>(init.status);
  const [sort, setSort] = useState<Sort>(init.sort);
  const [hideDup, setHideDup] = useState(init.hideDup);
  const [showFiltered, setShowFiltered] = useState(init.showFiltered);
  const [tagState, setTagState] = useState<TagState>(init.tagState);
  const [view, setView] = useState<View>(init.view);
  const [sheet, setSheet] = useState<"" | "status" | "source" | "sort" | "more">("");
  const [limit, setLimit] = useState(40);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [stubs, setStubs] = useState<Set<string>>(new Set()); // just rejected: keep their place as a stub
  const [snack, setSnack] = useState<{ uid: string; prev: Status } | null>(null);
  const url = asUrl(q);

  const current = { q: url ? "" : q, minScore, maxPrice, source, status, sort, hideDup, showFiltered, tagState };
  const isDefault = JSON.stringify(current) === JSON.stringify(DEFAULTS);
  const saved = JSON.stringify({ ...current, view });
  useEffect(() => { try { localStorage.setItem(KEY, saved); } catch { /* storage blocked */ } }, [saved]);

  const moreCount = (minScore > 0 ? 1 : 0) + (maxPrice !== "" ? 1 : 0) + Object.keys(tagState).length
    + (hideDup !== DEFAULTS.hideDup ? 1 : 0) + (showFiltered ? 1 : 0);
  const resetMore = () => { setMinScore(0); setMaxPrice(""); setTagState({}); setHideDup(true); setShowFiltered(false); };
  const reset = () => { resetMore(); setQ(""); setSource(""); setStatus("active"); setSort("score"); };

  // the "N new" pill: show what just arrived
  useEffect(() => {
    if (!showNewest) return;
    setStatus("new"); setSort("newest"); setQ(""); window.scrollTo(0, 0);
  }, [showNewest]);

  // pasting a link looks it up right away; an Otodom offer we don't have yet gets fetched and added
  useEffect(() => {
    if (!url) { setLookup(null); return; }
    let live = true;
    setLookup({ url, busy: true });
    const t = setTimeout(() => api.byUrl(url)
      .then(r => {
        if (!live) return;
        setLookup({ url, busy: false, found: r.found, listing: r.listing });
        setAll(xs => xs && (xs.some(l => l.uid === r.listing.uid) ? xs : [r.listing, ...xs]));
      })
      .catch(e => live && setLookup({ url, busy: false, error: e instanceof Error ? e.message : String(e) })), 500);
    return () => { live = false; clearTimeout(t); };
  }, [url]);

  useEffect(() => { api.listings(showFiltered).then(setAll).catch(() => setAll([])); setStubs(new Set()); }, [showFiltered, reloadToken]);
  useEffect(() => { setStubs(new Set()); setLimit(40); }, [status, source, sort]);

  // pull down at the top: reload the list from the server (no scraping, no AI) and drop the "Restore" rows
  const ptr = usePullToRefresh(async () => {
    const fresh = await api.listings(showFiltered);
    setAll(fresh);
    setStubs(new Set());
    setSnack(null);
  });

  useEffect(() => {
    if (all) onCounts({ fresh: all.filter(l => l.status === "new").length, total: all.length });
  }, [all, onCounts]);

  // everything except the status filter: used for the list and for the counts in the status sheet
  const base = useMemo(() => {
    if (!all) return [];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter(l => {
      if (source && l.source !== source) return false;
      if (minScore > 0 && (l.ai_score ?? -1) < minScore) return false;
      if (maxPrice !== "" && (l.total_price ?? 0) > maxPrice) return false;
      if (hideDup && l.duplicate_of) return false;
      for (const [t, s] of Object.entries(tagState)) {
        if (s === 1 && !l.tags.includes(t)) return false;
        if (s === -1 && l.tags.includes(t)) return false;
      }
      if (words.length) {
        const hay = [l.title, l.location.district, l.location.city, l.location.street, l.author_name, l.ai?.summary, l.note]
          .join(" ").toLowerCase();
        if (!words.every(w => hay.includes(w))) return false;
      }
      return true;
    });
  }, [all, q, minScore, maxPrice, source, hideDup, tagState]);

  const visible = useMemo(() => {
    const xs = base.filter(l => matchesStatus(l, status) || stubs.has(l.uid));
    const key: Record<Sort, (l: Listing) => number> = {
      score: l => -(l.ai_score ?? -1),
      newest: l => -Date.parse(l.created_at || l.first_seen),
      price: l => l.total_price ?? 1e9,
      ppm: l => (l.total_price && l.area_m2 ? l.total_price / l.area_m2 : 1e9),
      area: l => -(l.area_m2 ?? 0),
    };
    return xs.sort((a, b) => key[sort](a) - key[sort](b));
  }, [base, status, sort, stubs]);

  const setLocal = (uid: string, s: Status) => {
    setAll(xs => xs && xs.map(l => (l.uid === uid ? { ...l, status: s } : l)));
    setLookup(x => (x?.listing?.uid === uid ? { ...x, listing: { ...x.listing, status: s } } : x));
  };
  const onStatus = useCallback(async (uid: string, s: Status) => {
    const prev = all?.find(l => l.uid === uid)?.status ?? "seen";
    const hides = s === "rejected" && status !== "rejected" && status !== "all";
    if (hides) {
      // remember where this card starts on screen: the next card is scrolled to exactly that spot
      const el = document.querySelector(`[data-uid="${CSS.escape(uid)}"]`);
      if (el) anchor.current = { uid, top: el.getBoundingClientRect().top };
      setStubs(x => new Set(x).add(uid)); // shrink to a stub right away (no flash of the list jumping)
    }
    setLocal(uid, s); // instant; the server catches up
    try { await api.setStatus(uid, s); } catch {
      setLocal(uid, prev);
      if (hides) setStubs(x => { const n = new Set(x); n.delete(uid); return n; });
      return;
    }
    if (hides) {
      setSnack({ uid, prev });
    } else if (prev === "rejected") {
      setStubs(x => { const n = new Set(x); n.delete(uid); return n; });
    }
  }, [all, status]);
  // after a reject: put the next card where the rejected one was (never under the sticky top bar)
  const anchor = useRef<{ uid: string; top: number } | null>(null);
  useLayoutEffect(() => {
    const a = anchor.current;
    if (!a) return;
    anchor.current = null;
    const next = document.querySelector(`[data-uid="${CSS.escape(a.uid)}"]`)?.nextElementSibling;
    if (!next || !next.hasAttribute("data-uid")) return;
    const bar = document.querySelector(".appbar")?.getBoundingClientRect().bottom ?? 0;
    const target = Math.max(a.top, bar + 8);
    window.scrollBy({ top: next.getBoundingClientRect().top - target, behavior: "instant" as ScrollBehavior });
  });
  const undoReject = () => { if (snack) onStatus(snack.uid, snack.prev); };
  const onNote = (uid: string, note: string) => setAll(xs => xs && xs.map(l => (l.uid === uid ? { ...l, note } : l)));

  if (!all) return <p className="center">Loading listings…</p>;

  const counts = Object.fromEntries((Object.keys(STATUS_LABEL) as StatusFilter[])
    .map(s => [s, base.filter(l => matchesStatus(l, s)).length])) as Record<StatusFilter, number>;
  const newCount = all.filter(l => l.status === "new").length;
  const ranked = all.filter(l => l.ai_score != null).length;
  const closeSheet = () => setSheet("");

  return (
    <div>
      <PullIndicator {...ptr} />
      <div className="filterbar">
        <div className="top">
          <label className="search">
            <Icon name="search" size={18} />
            <input placeholder="Search or paste a link" value={q} onChange={e => setQ(e.target.value)} enterKeyHint="search" />
            {q && <button className="clear" aria-label="Clear search" onClick={() => setQ("")}><Icon name="x" size={18} /></button>}
          </label>
          <button className="iconbtn" aria-label="More filters" onClick={() => setSheet("more")}>
            <Icon name="filter" />{moreCount > 0 && <span className="count">{moreCount}</span>}
          </button>
        </div>
        <div className="chiprow">
          <button className={"chip" + (status !== "active" ? " on" : "")} onClick={() => setSheet("status")}>
            {STATUS_LABEL[status]}{status !== "active" && <span className="n">{counts[status]}</span>}<Icon name="down" size={15} />
          </button>
          <button className={"chip" + (source ? " on" : "")} onClick={() => setSheet("source")}>
            {SOURCE_LABEL[source]}<Icon name="down" size={15} />
          </button>
          <button className={"chip" + (sort !== "score" ? " on" : "")} onClick={() => setSheet("sort")}>
            {SORT_LABEL[sort]}<Icon name="down" size={15} />
          </button>
          <button className="chip viewToggle" aria-label={`Card view: ${view}. Tap to switch`}
            onClick={() => setView(view === "short" ? "full" : "short")}>
            <Icon name={view === "short" ? "compact" : "expand"} size={15} />{view === "short" ? "Short" : "Full"}
          </button>
        </div>
        {!url && <div className="stats"><b>{visible.length}</b> shown · {newCount} new · {ranked} ranked</div>}
      </div>

      {lookup && (
        <div className="lookup">
          {lookup.busy && <div className="muted small row"><span className="spin" />Looking up this link… a new Otodom offer takes a few seconds.</div>}
          {lookup.error && <div className="err small">{lookup.error}</div>}
          {lookup.listing && <>
            <div className="small">
              {lookup.found === "added" ? <b className="ok">Added to your listings.</b> : <b>Already in your listings.</b>}
              {lookup.listing.filter_ok === 0 && <span className="muted"> It doesn't pass your filters, so it shows only with "Show filtered-out" on.</span>}
              {lookup.found === "added" && lookup.listing.ai_score == null && <span className="muted"> Not ranked yet: the next update scores it.</span>}
            </div>
            <ListingCard key={lookup.listing.uid} l={lookup.listing} tags={meta.tags} onStatus={onStatus} onNote={onNote} view={view} />
          </>}
        </div>
      )}

      {!url && <>
        {visible.length === 0 && (
          <div className="empty">
            {all.length === 0 ? "No listings yet. Press Update to download the first ones." : "Nothing matches these filters."}
            {!isDefault && <button className="btn sm" onClick={reset}>Reset filters</button>}
          </div>
        )}
        <div className="cards">
          {visible.slice(0, limit).map(l => (
            <div key={l.uid} data-uid={l.uid} className="cardSlot">
              <ListingCard l={l} tags={meta.tags} onStatus={onStatus} onNote={onNote} view={view}
                stub={stubs.has(l.uid) && l.status === "rejected"} />
            </div>
          ))}
          {visible.length > limit && (
            <button className="btn block" onClick={() => setLimit(x => x + 40)}>Show more ({visible.length - limit} left)</button>
          )}
        </div>
      </>}

      {sheet === "status" && (
        <Choice title="Show" value={status} onPick={setStatus} onClose={closeSheet}
          options={(Object.keys(STATUS_LABEL) as StatusFilter[]).map(s => ({ value: s, label: STATUS_LABEL[s], count: counts[s] }))} />
      )}
      {sheet === "source" && (
        <Choice title="Site" value={source} onPick={setSource} onClose={closeSheet}
          options={(Object.keys(SOURCE_LABEL) as Source[]).map(s => ({ value: s, label: SOURCE_LABEL[s] }))} />
      )}
      {sheet === "sort" && (
        <Choice title="Sort by" value={sort} onPick={setSort} onClose={closeSheet}
          options={(Object.keys(SORT_LABEL) as Sort[]).map(s => ({ value: s, label: s === "score" ? "Best AI score" : SORT_LABEL[s] }))} />
      )}
      {sheet === "more" && (
        <Sheet title="More filters" onClose={closeSheet} closeButton>
          <div className="body">
            <div className="pair">
              <label className="field"><span className="flabel">Max price, zł</span>
                <input className="input" type="number" inputMode="numeric" step={100} value={maxPrice} placeholder="any"
                  onChange={e => setMaxPrice(e.target.value === "" ? "" : +e.target.value)} />
              </label>
              <label className="field"><span className="flabel">Min AI score</span>
                <input className="input" type="number" inputMode="numeric" min={0} max={100} value={minScore || ""} placeholder="0"
                  onChange={e => setMinScore(+e.target.value || 0)} />
              </label>
            </div>
            <div className="field" role="group" aria-label="Tags">
              <span className="flabel">Tags</span>
              <span className="hint">Tap once to require, twice to exclude, three times to ignore.</span>
              <TagPicker tags={meta.tags} value={tagState} onChange={setTagState} />
            </div>
            <div>
              <div className="switchrow">Hide duplicates<Switch on={hideDup} onChange={setHideDup} label="Hide duplicates" /></div>
              <div className="switchrow"><span>Show filtered-out<small className="hint">Listings your saved search filters hide</small></span>
                <Switch on={showFiltered} onChange={setShowFiltered} label="Show filtered-out" /></div>
            </div>
          </div>
          <div className="foot">
            <button className="btn" disabled={moreCount === 0} onClick={resetMore}>Reset</button>
            <button className="btn primary" onClick={closeSheet}>Show {visible.length}</button>
          </div>
        </Sheet>
      )}

      {snack && (
        <Snackbar key={snack.uid} text="Listing rejected" action="Undo" onAction={undoReject} onDone={() => setSnack(null)} />
      )}
    </div>
  );
}
