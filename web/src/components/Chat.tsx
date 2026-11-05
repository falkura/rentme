import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { api } from "../api";
import type { ChatMsg, FilterChange, Listing, Meta, SavedChat, Status } from "../types";
import ListingCard from "./ListingCard";
import Composer from "./Composer";
import FilterChangeCard from "./FilterChangeCard";
import MemoryEditor from "./MemoryEditor";
import { Icon, Sheet, Switch } from "./ui";

const SUGGESTIONS = [
  "Show me the 5 best matches and why",
  "Compare my favorites and recommend one",
  "Rate the listings that have no AI score yet",
  "Which flats allow pets? Check the descriptions",
];

const TOOL_LABEL: Record<string, string> = {
  search_listings: "searched listings", get_listing: "read listings", set_listing_status: "changed listing status",
  rank_listings: "rated listings", update_settings: "changed settings",
  database_stats: "checked database stats", remember: "saved to memory",
  update_search_filters: "changed search filters",
};

const STORE = "rentme-chat";
// {{otodom:1}}, {otodom:1} or a bare otodom:1
const UID_RE = /\{{0,2}((?:otodom|olx):\d+)\}{0,2}/g;

function uidsOf(m: ChatMsg): string[] {
  if (m.uids && m.uids.length) return m.uids;
  if (m.role !== "assistant") return [];
  return [...new Set([...m.text.matchAll(UID_RE)].map(x => x[1]))];
}
const openHref = (uid: string) => `/api/listings/${encodeURIComponent(uid)}/open`;

function loadLocal(): { sid: string | null; msgs: ChatMsg[] } {
  try { return JSON.parse(localStorage.getItem(STORE) || "") || { sid: null, msgs: [] }; }
  catch { return { sid: null, msgs: [] }; }
}

type SheetName = "" | "chats" | "save" | "more" | "memory";

export default function Chat({ meta, keySet, active, onOpenSettings }: {
  meta: Meta; keySet: boolean; active: boolean; onOpenSettings: () => void;
}) {
  const [msgs, setMsgs] = useState<ChatMsg[]>(() => loadLocal().msgs);
  const [sid, setSid] = useState<string | null>(() => loadLocal().sid);
  const [busy, setBusy] = useState(false);
  const [cards, setCards] = useState<Record<string, Listing>>({});
  const [memory, setMemory] = useState<string[] | null>(null);
  const [memSaved, setMemSaved] = useState("");
  const [canEdit, setCanEdit] = useState<boolean | null>(null);
  const [title, setTitle] = useState<string | null>(null);   // set when the current chat is saved
  const [naming, setNaming] = useState("");
  const [saveErr, setSaveErr] = useState("");
  const [sheet, setSheet] = useState<SheetName>("");
  const [saved, setSaved] = useState<SavedChat[] | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { api.settings().then(s => setCanEdit(!!s.config.ai.chat_can_edit_filters)).catch(() => {}); }, []);

  const toggleCanEdit = async (v: boolean) => {
    setCanEdit(v);
    try { await api.patchAi({ chat_can_edit_filters: v }); } catch { setCanEdit(!v); }
  };

  const onFilterAction = async (id: string, action: "apply" | "dismiss" | "undo") => {
    if (!sid) throw new Error("This chat is no longer on the server");
    const r = await api.filterAction(sid, id, action);
    setMsgs(ms => ms.map(m => m.filters?.some(f => f.id === id)
      ? { ...m, filters: m.filters.map(f => (f.id === id ? r.change : f)) } : m));
    return r.passing;
  };

  // restore the conversation from the server (survives reloads, restarts and other browsers)
  useEffect(() => {
    if (!sid) return;
    api.chatHistory(sid)
      .then(h => { setMsgs(h.messages); setTitle(h.saved ? h.title : null); })
      .catch(() => { /* server doesn't know it: keep the local copy */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify({ msgs, sid })); } catch { /* ignore */ }
  }, [msgs, sid]);
  useEffect(() => { if (active) end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs.length, busy, active]);

  // load cards for every listing the assistant mentioned
  useEffect(() => {
    const need = [...new Set(msgs.flatMap(uidsOf))].filter(u => !(u in cards));
    if (need.length)
      api.listingsByUid(need).then(ls => setCards(c => ({
        ...c, ...Object.fromEntries(need.map(u => [u, ls.find(l => l.uid === u)!])),
      }))).catch(() => {});
  }, [msgs, cards]);

  const send = async (text: string) => {
    text = text.trim();
    if (!text || busy) return;
    setMsgs(m => [...m, { role: "user", text }]);
    setBusy(true);
    try {
      const r = await api.chat(text, sid);
      setSid(r.session_id);
      setMsgs(m => [...m, { role: "assistant", text: r.answer, uids: r.listing_uids, steps: r.steps, filters: r.filters }]);
      if (r.steps.some(s => s.tool === "remember")) setMemory(null);
      if (r.job_started) window.dispatchEvent(new Event("rentme:update-started"));
      if (r.steps.some(s => s.tool === "set_listing_status" || s.tool === "rank_listings")) setCards({});
    } catch (e) {
      setMsgs(m => [...m, { role: "error", text: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setBusy(false);
    }
  };

  // New chat: a saved chat stays in the list, an unsaved one is deleted
  const reset = async () => {
    if (sid && !title) await api.resetChat(sid).catch(() => {});
    setSid(null); setMsgs([]); setTitle(null); setSaved(null); setSheet("");
  };

  const saveChat = async () => {
    if (!sid) return;
    setSaveErr("");
    try {
      const r = await api.saveChat(sid, naming.trim() || null);
      setTitle(r.title); setSaved(null); setSheet("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSaveErr(msg === "Not Found"
        ? "Could not save: the server is older than this page, or this chat no longer exists on it. Restart rentme and try again."
        : `Could not save: ${msg}`);
    }
  };

  const openChats = async () => {
    setSheet("chats");
    setSaved(await api.savedChats().catch(() => []));
  };

  const loadChat = async (id: string) => {
    if (id === sid) { setSheet(""); return; }
    if (sid && !title && msgs.length && !window.confirm("The current chat is not saved and will be lost. Continue?")) return;
    const h = await api.chatHistory(id);
    if (sid && !title) await api.resetChat(sid).catch(() => {});
    setSid(id); setMsgs(h.messages); setTitle(h.title || "Untitled chat"); setSheet("");
  };

  const deleteChat = async (id: string, name: string) => {
    if (!window.confirm(`Delete the chat "${name}"?`)) return;
    await api.resetChat(id).catch(() => {});
    setSaved(xs => xs && xs.filter(x => x.id !== id));
    if (id === sid) { setSid(null); setMsgs([]); setTitle(null); setSheet(""); }
  };

  const openMemory = async () => {
    setSheet("memory"); setMemSaved("");
    if (memory === null) setMemory((await api.settings()).config.ai.memory);
  };
  const saveMemory = async () => {
    if (!memory) return;
    const r = await api.saveMemory(memory.map(m => m.trim()).filter(Boolean));
    setMemory(r.config.ai.memory); setMemSaved("Saved. Applies from your next message.");
  };

  const onStatus = async (uid: string, s: Status) => {
    setCards(c => ({ ...c, [uid]: { ...c[uid], status: s } }));
    await api.setStatus(uid, s).catch(() => setCards({}));
  };

  // a listing can be mentioned in several messages: jump to the card under the same message
  const focusCard = (uid: string, msg: number): boolean => {
    const el = document.getElementById(`card-${msg}-${uid}`);
    if (!el) return false;
    const det = el.closest("details");
    if (det) det.open = true;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
    return true;
  };

  const withLinks = (t: string) => t.replace(UID_RE, (_, uid) => `[${uid}](#card-${uid})`);

  const Ref = ({ uid, msg }: { uid: string; msg: number }) => {
    const l = cards[uid];
    const label = l ? l.title : uid;
    return (
      <span className="ref">
        <a href={l?.url || openHref(uid)} target="_blank" rel="noreferrer" title={l ? l.title : uid}
          onClick={e => {
            if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
            if (focusCard(uid, msg)) e.preventDefault();
          }}>{label}</a>
        {l && <span className="refMeta">{l.ai_score ?? "–"} · {l.total_price ? `${Math.round(l.total_price).toLocaleString("pl-PL")} zł` : "?"}</span>}
        <a className="refOpen" href={l?.url || openHref(uid)} target="_blank" rel="noreferrer" aria-label="Open listing in a new tab">
          <Icon name="external" size={16} />
        </a>
      </span>
    );
  };

  const hasChat = msgs.length > 0;

  return (
    <div className="chat">
      <header className="chathead">
        <button className="title" onClick={openChats} aria-label="Saved chats">
          {hasChat && !title && <span className="unsaved" title="Not saved" />}
          <b>{title || (hasChat ? "Unsaved chat" : "New chat")}</b><Icon name="down" size={16} />
        </button>
        <button className="btn ghost icon" aria-label={title ? "Rename chat" : "Save chat"} disabled={!sid || !hasChat}
          onClick={() => { setNaming(title || ""); setSaveErr(""); setSheet("save"); }}>
          <Icon name="bookmark" filled={!!title} />
        </button>
        <button className="btn ghost icon" aria-label="New chat" disabled={!hasChat} onClick={reset}><Icon name="plus" /></button>
        <button className="btn ghost icon" aria-label="More" onClick={() => setSheet("more")}><Icon name="more" /></button>
      </header>

      <div className="msgs">
        {!hasChat && keySet && (
          <div className="suggest">
            {SUGGESTIONS.map(s => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}
          </div>
        )}
        {!keySet && (
          <div className="empty">
            AI search needs your Anthropic API key.
            <button className="btn sm primary" onClick={onOpenSettings}>Add it in Settings</button>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.role === "assistant" && m.steps && m.steps.length > 0 && (
              <details className="steps">
                <summary><Icon name="right" size={14} />{m.steps.length} step{m.steps.length > 1 ? "s" : ""}: {[...new Set(m.steps.map(s => TOOL_LABEL[s.tool] || s.tool))].join(", ")}</summary>
                {m.steps.map((s, j) => <code key={j}>{s.tool}({JSON.stringify(s.input)})</code>)}
              </details>
            )}
            {m.role === "assistant" ? (
              <div className="md">
                <Markdown components={{
                  a: ({ href, children }) => href?.startsWith("#card-")
                    ? <Ref uid={href.slice(6)} msg={i} />
                    : <a href={href} target="_blank" rel="noreferrer">{children}</a>,
                }}>{withLinks(m.text)}</Markdown>
              </div>
            ) : <div>{m.text}</div>}
            {m.filters?.map((f: FilterChange) => (
              <FilterChangeCard key={f.id} change={f} tags={meta.tags} onAction={a => onFilterAction(f.id, a)} />
            ))}
            {uidsOf(m).length > 0 && (
              <details className="mentioned">
                <summary>Show {uidsOf(m).length} listing{uidsOf(m).length > 1 ? "s" : ""}</summary>
                {uidsOf(m).map(u => cards[u] && (
                  <div key={u} id={`card-${i}-${u}`}><ListingCard l={cards[u]} tags={meta.tags} onStatus={onStatus} /></div>
                ))}
              </details>
            )}
          </div>
        ))}
        {busy && <div className="msg assistant thinking"><span className="spin" />Searching your listings…</div>}
        <div ref={end} />
      </div>

      <Composer busy={busy} onSend={send} disabled={!keySet}
        placeholder={hasChat ? "Ask a follow-up" : "Ask about your listings"} />

      {sheet === "chats" && (
        <Sheet title="Saved chats" onClose={() => setSheet("")}>
          <button className="item" onClick={reset} disabled={!hasChat}><Icon name="plus" />New chat</button>
          <div className="sep" />
          {saved === null && <div className="item muted"><span className="spin" />Loading…</div>}
          {saved?.length === 0 && <div className="item muted small">No saved chats yet. Save one with the bookmark button.</div>}
          {saved?.map(c => (
            <div key={c.id} className={"row" + (c.id === sid ? " current" : "")} style={{ flexWrap: "nowrap", gap: 0 }}>
              <button className={"item" + (c.id === sid ? " current" : "")} onClick={() => loadChat(c.id)}>
                <Icon name="chat" />
                <span className="sub"><span>{c.title}</span><small>{c.messages} messages · {new Date(c.updated).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</small></span>
              </button>
              <button className="btn ghost icon" aria-label={`Delete ${c.title}`} onClick={() => deleteChat(c.id, c.title)}><Icon name="trash" size={18} /></button>
            </div>
          ))}
        </Sheet>
      )}

      {sheet === "save" && (
        <Sheet title={title ? "Rename chat" : "Save chat"} onClose={() => setSheet("")} closeButton>
          <form className="body" onSubmit={e => { e.preventDefault(); saveChat(); }}>
            <label className="field"><span className="flabel">Name</span>
              <input className="input" autoFocus value={naming} placeholder="Optional, e.g. Mokotów 3 rooms" onChange={e => setNaming(e.target.value)} />
            </label>
            {saveErr && <div className="err small">{saveErr}</div>}
            <span className="hint">A saved chat keeps its new messages automatically.</span>
            <button className="btn primary block">Save</button>
          </form>
        </Sheet>
      )}

      {sheet === "more" && (
        <Sheet title="AI search" onClose={() => setSheet("")}>
          <button className="item" onClick={openMemory}><Icon name="memory" />Memory</button>
          {canEdit !== null && (
            <div className="item">
              <Icon name="sliders" />
              <span className="sub"><span>AI may change settings</span><small>{canEdit ? "Changes them itself; you can Undo" : "Suggests changes for you to apply"}</small></span>
              <Switch on={canEdit} onChange={toggleCanEdit} label="AI may change settings" />
            </div>
          )}
          {sid && hasChat && <>
            <div className="sep" />
            <button className="item danger" onClick={() => { setSheet(""); deleteChat(sid, title || "this chat"); }}><Icon name="trash" />Delete chat</button>
          </>}
        </Sheet>
      )}

      {sheet === "memory" && (
        <Sheet title="Memory" onClose={() => setSheet("")} closeButton>
          <div className="body">
            <span className="hint">Rules AI search always follows. Also used in Settings.</span>
            {memory === null ? <span className="muted">Loading…</span> : <MemoryEditor value={memory} onChange={m => { setMemory(m); setMemSaved(""); }} />}
            {memSaved && <span className="ok small">{memSaved}</span>}
          </div>
          <div className="foot">
            <button className="btn" onClick={() => setSheet("")}>Close</button>
            <button className="btn primary" disabled={!memory} onClick={saveMemory}>Save memory</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
