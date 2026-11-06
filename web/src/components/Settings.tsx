import { useEffect, useState, type ReactNode } from "react";
import OlxImport from "./OlxImport";
import RescoreNew from "./RescoreNew";
import { api } from "../api";
import type { KeyStatus, Meta, Settings } from "../types";
import TagPicker, { fromTagState, toTagState } from "./TagPicker";
import MemoryEditor from "./MemoryEditor";
import { Choice, Icon, Sheet, Switch, requestUpdate } from "./ui";
import { canPromptInstall, getTheme, isIOS, isStandalone, onInstallChange, promptInstall, setTheme, type Theme } from "../theme";

const THEME_LABEL: Record<Theme, string> = { system: "Same as phone", light: "Light", dark: "Dark" };

const CITY_LABELS: Record<string, string> = {
  warszawa: "Warszawa", krakow: "Kraków", wroclaw: "Wrocław", poznan: "Poznań", gdansk: "Gdańsk",
  gdynia: "Gdynia", lodz: "Łódź", katowice: "Katowice", lublin: "Lublin", szczecin: "Szczecin",
};

type Page = "" | "apartment" | "districts" | "tags" | "prefs" | "memory" | "model" | "key" | "sites" | "advanced";
const TITLES: Record<Exclude<Page, "">, string> = {
  apartment: "Apartment", districts: "Districts and words", tags: "Tags", prefs: "What you want", memory: "Memory",
  model: "Model and cost", key: "API key", sites: "Sites", advanced: "Advanced",
};

/** One setting. A single input is wrapped in a <label>; a group of controls must not be (a label forwards
 * clicks on its text to the first button inside). */
function Field({ label, hint, children, group = false }: { label: string; hint?: ReactNode; children: ReactNode; group?: boolean }) {
  const inner = <><span className="flabel">{label}</span>{children}{hint && <span className="hint">{hint}</span>}</>;
  return group ? <div className="field" role="group" aria-label={label}>{inner}</div> : <label className="field">{inner}</label>;
}

function Row({ icon, label, summary, value, valueClass, onClick }: {
  icon: string; label: string; summary?: string; value?: string; valueClass?: string; onClick: () => void;
}) {
  return (
    <button className="listrow" onClick={onClick}>
      <Icon name={icon} />
      <span className="txt">{label}{summary && <small>{summary}</small>}</span>
      {value && <span className={"val " + (valueClass || "")}>{value}</span>}
      <Icon name="right" size={18} />
    </button>
  );
}

const numOrNull = (v: string) => (v === "" ? null : Number(v));
const zl = (n: number) => `${n.toLocaleString("pl-PL")} zł`;
const range = (a: number | null, b: number | null, unit: (n: number) => string) =>
  a != null && b != null ? `${unit(a)}–${unit(b)}` : b != null ? `≤ ${unit(b)}` : a != null ? `≥ ${unit(a)}` : null;

/** Count the fields that differ between two configs (for "N changes" in the save bar). */
function diffCount(a: Settings, b: Settings): number {
  let n = 0;
  for (const sec of Object.keys(a) as (keyof Settings)[])
    for (const k of Object.keys(a[sec])) {
      const x = (a[sec] as Record<string, unknown>)[k], y = (b[sec] as Record<string, unknown>)[k];
      if (JSON.stringify(x) !== JSON.stringify(y)) n++;
    }
  return n;
}

export default function SettingsPage({ meta, keyStatus, onKeyChange, onSaved, onDirty, hasListings }: {
  meta: Meta; keyStatus: KeyStatus | null; onKeyChange: (k: KeyStatus) => void; onSaved: () => void;
  onDirty: (d: boolean) => void; hasListings: boolean;
}) {
  const [cfg, setCfg] = useState<Settings | null>(null);
  const [orig, setOrig] = useState<Settings | null>(null);
  const [page, setPage] = useState<Page>("");
  const [newKey, setNewKey] = useState("");
  const [keyMsg, setKeyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [kwInput, setKwInput] = useState("");
  const [distInput, setDistInput] = useState("");
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const [appSheet, setAppSheet] = useState<"" | "theme" | "install">("");
  const [canInstall, setCanInstall] = useState(canPromptInstall);
  useEffect(() => onInstallChange(() => setCanInstall(canPromptInstall())), []);

  useEffect(() => {
    api.settings().then(s => { setCfg(s.config); setOrig(s.config); onKeyChange(s.api_key); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const changes = cfg && orig ? diffCount(cfg, orig) : 0;
  useEffect(() => { onDirty(changes > 0); }, [changes, onDirty]);
  useEffect(() => { window.scrollTo(0, 0); }, [page]);

  if (!cfg || !orig || !keyStatus) return <p className="center">Loading settings…</p>;

  const s = cfg.search;
  const set = <K extends keyof Settings>(sec: K, patch: Partial<Settings[K]>) =>
    setCfg({ ...cfg, [sec]: { ...cfg[sec], ...patch } });
  const customCity = !meta.cities.includes(s.city);

  const save = async (andUpdate: boolean) => {
    setSaving(true); setSaveMsg("");
    try {
      const r = await api.saveSettings(cfg);
      setCfg(r.config); setOrig(r.config);
      onSaved();
      if (andUpdate) requestUpdate();
      setSaveMsg(andUpdate ? "Saved. Update started." : `Saved. ${r.refiltered} stored listings re-checked.`);
      setTimeout(() => setSaveMsg(""), 4000);
    } catch (e) {
      setSaveMsg(`Could not save: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  };

  const saveKey = async (k: string) => {
    setKeyBusy(true);
    try {
      const st = await api.setKey(k);
      onKeyChange(st); setNewKey("");
      if (k) {
        setKeyMsg({ ok: true, text: "Key saved. Testing…" });
        const t = await api.testKey();
        setKeyMsg(t.ok ? { ok: true, text: "Key works." } : { ok: false, text: t.error || "Key does not work." });
      } else setKeyMsg({ ok: true, text: "Key removed." });
    } catch (e) {
      setKeyMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setKeyBusy(false);
    }
  };
  const testKey = async () => {
    setKeyBusy(true);
    const t = await api.testKey().catch(e => ({ ok: false, error: String(e) }));
    setKeyMsg(t.ok ? { ok: true, text: "Key works." } : { ok: false, text: t.error || "Key does not work." });
    setKeyBusy(false);
  };

  const toggleRoom = (r: number) =>
    set("search", { rooms: s.rooms.includes(r) ? s.rooms.filter(x => x !== r) : [...s.rooms, r].sort() });
  const addKw = () => {
    const k = kwInput.trim();
    if (k && !s.exclude_keywords.includes(k)) set("search", { exclude_keywords: [...s.exclude_keywords, k] });
    setKwInput("");
  };
  const districts = s.excluded_districts || [];
  const addDistrict = () => {
    const d = distInput.trim();
    if (d && !districts.some(x => x.toLowerCase() === d.toLowerCase())) set("search", { excluded_districts: [...districts, d] });
    setDistInput("");
  };

  // ---- summaries for the rows ----
  const city = CITY_LABELS[s.city] || s.city || "no city";
  const rooms = s.rooms.length ? `${s.rooms.map(r => (r === 4 ? "4+" : r)).join(", ")} rooms` : "any rooms";
  const apartmentSum = [city, rooms, range(s.area_min, s.area_max, n => `${n} m²`), range(s.price_min, s.price_max, zl), s.private_only ? "private only" : null]
    .filter(Boolean).join(" · ");
  const distSum = [districts.length ? `${districts.length} district${districts.length > 1 ? "s" : ""} excluded` : null,
    s.exclude_keywords.length ? `${s.exclude_keywords.length} word${s.exclude_keywords.length > 1 ? "s" : ""}` : null]
    .filter(Boolean).join(" · ") || "Nothing excluded";
  const tagSum = [s.required_tags.length ? `${s.required_tags.length} required` : null, s.excluded_tags.length ? `${s.excluded_tags.length} excluded` : null]
    .filter(Boolean).join(" · ") || "Any";
  const model = meta.models.find(m => m.id === cfg.ai.model)?.label.replace(/\s*\(.*\)$/, "") || cfg.ai.model;
  const modelSum = cfg.ai.enabled ? `${model} · ${cfg.ai.effort} effort · ${cfg.ai.max_per_run} per update` : "AI ranking off";
  const sitesSum = [cfg.sources.otodom ? "Otodom on" : "Otodom off", cfg.sources.olx ? "OLX on" : "OLX by import"].join(" · ");

  // ---- first-run checklist ----
  const steps = [
    { done: keyStatus.set, label: "Add your API key", go: () => setPage("key") },
    { done: !!s.city && (s.price_max != null || s.rooms.length > 0), label: "Set city and budget", go: () => setPage("apartment") },
    { done: cfg.ai.preferences.trim().length > 0, label: "Describe what you want", go: () => setPage("prefs") },
    { done: hasListings, label: "Run the first update", go: requestUpdate, primary: true },
  ];
  const doneCount = steps.filter(x => x.done).length;

  const saveBar = (changes > 0 || saveMsg) && (
    <div className="savebar">
      <span className="stext">
        {changes > 0 ? `${changes} change${changes > 1 ? "s" : ""}` : saveMsg}
        {changes > 0 && <small>{saveMsg || "Not saved yet"}</small>}
      </span>
      {changes > 0 && <>
        <button className="btn ghost sm" disabled={saving} onClick={() => { setCfg(orig); setSaveMsg(""); }}>Discard</button>
        <button className="btn sm" disabled={saving} onClick={() => save(false)}>Save</button>
        <button className="btn sm primary" disabled={saving} onClick={() => save(true)}>{saving ? "Saving…" : "Save and update"}</button>
      </>}
    </div>
  );

  // ---------------- sub-pages ----------------
  if (page) {
    let body: ReactNode = null;
    if (page === "apartment") body = <>
      <Field label="City">
        <select className="input" value={customCity ? "__custom" : s.city} onChange={e => set("search", { city: e.target.value === "__custom" ? "" : e.target.value })}>
          {meta.cities.map(c => <option key={c} value={c}>{CITY_LABELS[c] || c}</option>)}
          <option value="__custom">Other…</option>
        </select>
      </Field>
      {customCity && (
        <Field label="Other city" hint="Also set the Otodom location path and OLX city id in Sites.">
          <input className="input" value={s.city} onChange={e => set("search", { city: e.target.value })} placeholder="e.g. torun" />
        </Field>
      )}
      <div className="field">
        <div className="pair">
          <Field label="Min price, zł"><input className="input" type="number" inputMode="numeric" step={100} value={s.price_min ?? ""} placeholder="any" onChange={e => set("search", { price_min: numOrNull(e.target.value) })} /></Field>
          <Field label="Max price, zł"><input className="input" type="number" inputMode="numeric" step={100} value={s.price_max ?? ""} placeholder="any" onChange={e => set("search", { price_max: numOrNull(e.target.value) })} /></Field>
        </div>
        <span className="hint">Rent + czynsz.</span>
      </div>
      <div className="pair">
        <Field label="Min area, m²"><input className="input" type="number" inputMode="numeric" value={s.area_min ?? ""} placeholder="any" onChange={e => set("search", { area_min: numOrNull(e.target.value) })} /></Field>
        <Field label="Max area, m²"><input className="input" type="number" inputMode="numeric" value={s.area_max ?? ""} placeholder="any" onChange={e => set("search", { area_max: numOrNull(e.target.value) })} /></Field>
      </div>
      <Field group label="Rooms" hint="None selected = any.">
        <div className="chips">
          {[1, 2, 3, 4].map(r => (
            <button type="button" key={r} className={"chip" + (s.rooms.includes(r) ? " on" : "")} aria-pressed={s.rooms.includes(r)} onClick={() => toggleRoom(r)}>
              {r === 4 ? "4+" : r}
            </button>
          ))}
        </div>
      </Field>
      <div className="switchrow"><span>Private owners only<small className="hint">Skip agencies</small></span>
        <Switch on={s.private_only} onChange={v => set("search", { private_only: v })} label="Private owners only" /></div>
    </>;

    if (page === "districts") body = <>
      <Field group label="Excluded districts" hint="Matched on the listing's district, in Polish. You can also ask AI search: “exclude Bemowo”.">
        <div className="chips">
          {districts.map(d => (
            <span key={d} className="chip off">{d}
              <button type="button" className="x" aria-label={`Stop excluding ${d}`} onClick={() => set("search", { excluded_districts: districts.filter(x => x !== d) })}><Icon name="x" size={16} /></button>
            </span>
          ))}
          <input className="chipInput" value={distInput} placeholder="Add district" enterKeyHint="done" onChange={e => setDistInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addDistrict(); } }} onBlur={addDistrict} />
        </div>
      </Field>
      <Field group label="Excluded words" hint="Listings with these words in the title or description are hidden.">
        <div className="chips">
          {s.exclude_keywords.map(k => (
            <span key={k} className="chip off">{k}
              <button type="button" className="x" aria-label={`Stop excluding ${k}`} onClick={() => set("search", { exclude_keywords: s.exclude_keywords.filter(x => x !== k) })}><Icon name="x" size={16} /></button>
            </span>
          ))}
          <input className="chipInput" value={kwInput} placeholder="Add word" enterKeyHint="done" onChange={e => setKwInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addKw(); } }} onBlur={addKw} />
        </div>
      </Field>
    </>;

    if (page === "tags") body = (
      <Field group label="Required and excluded tags" hint="Tap once = must have, twice = must not have, three times = ignore.">
        <TagPicker tags={meta.tags} value={toTagState(s.required_tags, s.excluded_tags)}
          onChange={v => { const f = fromTagState(v); set("search", { required_tags: f.required, excluded_tags: f.excluded }); }} />
      </Field>
    );

    if (page === "prefs") body = <>
      <Field label="In your own words" hint="Every listing is scored against this. Hard requirements, nice-to-haves, things to avoid. A change re-ranks listings on the next update.">
        <textarea className="input" rows={14} value={cfg.ai.preferences} onChange={e => set("ai", { preferences: e.target.value })} />
      </Field>
      <RescoreNew dirty={changes > 0} models={meta.models} />
    </>;

    if (page === "memory") body = (
      <Field group label="Rules AI search always follows" hint="Edits apply to open chats from the next message.">
        <MemoryEditor value={cfg.ai.memory} onChange={memory => set("ai", { memory })} />
      </Field>
    );

    if (page === "model") body = <>
      <div className="switchrow"><span>Rank listings with AI on update</span>
        <Switch on={cfg.ai.enabled} onChange={v => set("ai", { enabled: v })} label="Rank listings with AI on update" /></div>
      <Field label="Model" hint="Used for ranking and chat. Haiku is about 40× cheaper than Opus.">
        <select className="input" value={cfg.ai.model} onChange={e => set("ai", { model: e.target.value })}>
          {meta.models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </Field>
      <div className="pair">
        <Field label="Ranking effort">
          <select className="input" value={cfg.ai.effort} onChange={e => set("ai", { effort: e.target.value })}>
            {["low", "medium", "high"].map(x => <option key={x}>{x}</option>)}
          </select>
        </Field>
        <Field label="Chat effort">
          <select className="input" value={cfg.ai.chat_effort} onChange={e => set("ai", { chat_effort: e.target.value })}>
            {["low", "medium", "high"].map(x => <option key={x}>{x}</option>)}
          </select>
        </Field>
      </div>
      <div className="pair">
        <Field label="Listings per request"><input className="input" type="number" inputMode="numeric" min={1} max={15} value={cfg.ai.batch_size} onChange={e => set("ai", { batch_size: +e.target.value })} /></Field>
        <Field label="Max ranked per update" hint="Cost cap per run."><input className="input" type="number" inputMode="numeric" min={1} value={cfg.ai.max_per_run} onChange={e => set("ai", { max_per_run: +e.target.value })} /></Field>
      </div>
    </>;

    if (page === "key") body = (
      <div className="keybox">
        <div className="small">
          {keyStatus.set
            ? <span className="ok">Set: {keyStatus.hint}, from {keyStatus.source}.</span>
            : <span className="err">No key yet. AI ranking and AI search are off.</span>}
        </div>
        <Field label={keyStatus.set ? "Replace key" : "Anthropic API key"}
          hint={<>Create one at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a> (needs billing with credits; separate from a claude.ai subscription). Saved to secrets.json and never shown again.</>}>
          <input className="input" type="password" autoComplete="off" placeholder="sk-ant-…" value={newKey} onChange={e => setNewKey(e.target.value)} />
        </Field>
        <button className="btn primary block" disabled={!newKey.trim() || keyBusy} onClick={() => saveKey(newKey.trim())}>Save key</button>
        {keyStatus.set && (
          <div className="pair">
            <button className="btn" disabled={keyBusy} onClick={testKey}>{keyBusy ? "Testing…" : "Test"}</button>
            <button className="btn danger" disabled={keyBusy || keyStatus.source !== "secrets.json"} onClick={() => saveKey("")}>Remove</button>
          </div>
        )}
        {keyMsg && <div className={"small " + (keyMsg.ok ? "ok" : "err")}>{keyMsg.text}</div>}
      </div>
    );

    if (page === "sites") body = <>
      <div className="switchrow">Otodom.pl<Switch on={cfg.sources.otodom} onChange={v => set("sources", { otodom: v })} label="Otodom" /></div>
      <div className="switchrow"><span>OLX.pl, automatic<small className="hint">OLX usually blocks this. Use Import from OLX below instead.</small></span>
        <Switch on={cfg.sources.olx} onChange={v => set("sources", { olx: v })} label="OLX automatic" /></div>
      <Field label="Otodom location path" hint={<>Optional. Overrides the city: copy the part after <code>/wynajem/mieszkanie/</code> from an otodom.pl search, e.g. one district.</>}>
        <input className="input" value={cfg.sources.otodom_location} placeholder="mazowieckie/warszawa/warszawa/warszawa/mokotow"
          onChange={e => set("sources", { otodom_location: e.target.value })} />
      </Field>
      <Field label="OLX city id">
        <input className="input" type="number" inputMode="numeric" value={cfg.sources.olx_city_id || ""} placeholder="auto"
          onChange={e => set("sources", { olx_city_id: +e.target.value || 0 })} />
      </Field>
      <OlxImport dirty={changes > 0} />
    </>;

    if (page === "advanced") body = <>
      <Field label="Pages per site per update" hint="Otodom: 72 listings per page, OLX: 40.">
        <input className="input" type="number" inputMode="numeric" min={1} max={20} value={s.max_pages} onChange={e => set("search", { max_pages: +e.target.value })} />
      </Field>
      <Field label="Delay between requests, s" hint="Be polite; don't go below about 1 s.">
        <input className="input" type="number" inputMode="decimal" step={0.5} min={0.5} value={cfg.scrape.delay} onChange={e => set("scrape", { delay: +e.target.value })} />
      </Field>
      <Field label="Max detail pages per update" hint="Each new listing that passes the filters needs one request for its description.">
        <input className="input" type="number" inputMode="numeric" min={1} value={cfg.scrape.max_details_per_run} onChange={e => set("scrape", { max_details_per_run: +e.target.value })} />
      </Field>
      <Field label="Database file" hint="Takes effect after restarting the server.">
        <input className="input" value={cfg.scrape.db} onChange={e => set("scrape", { db: e.target.value })} />
      </Field>
    </>;

    return (
      <div>
        <div className="subhead">
          <button className="btn ghost sm" onClick={() => setPage("")}><Icon name="left" size={18} />Settings</button>
        </div>
        <div className="subpage">
          <h2 className="subtitle">{TITLES[page]}</h2>
          {body}
        </div>
        {saveBar}
      </div>
    );
  }

  // ---------------- main list ----------------
  return (
    <div className="settings">
      {doneCount < steps.length && (
        <div className="setup">
          <div className="shead"><b>Get started</b><small>{doneCount} of {steps.length}</small></div>
          <div className="progress"><i style={{ width: `${(doneCount / steps.length) * 100}%` }} /></div>
          <ul className="steplist">
            {steps.map(st => (
              <li key={st.label} className={st.done ? "done" : ""}>
                <span className="tick">{st.done && <Icon name="check" size={14} />}</span>
                <span>{st.label}</span>
                {!st.done && <button className={"btn sm" + (st.primary ? " primary" : "")} onClick={st.go}>{st.primary ? "Update" : "Open"}</button>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="group">
        <div className="glabel">Search</div>
        <div className="list">
          <Row icon="home" label="Apartment" summary={apartmentSum} onClick={() => setPage("apartment")} />
          <Row icon="map" label="Districts and words" summary={distSum} onClick={() => setPage("districts")} />
          <Row icon="tag" label="Tags" summary={tagSum} onClick={() => setPage("tags")} />
        </div>
      </div>

      <div className="group">
        <div className="glabel">AI</div>
        <div className="list">
          <Row icon="chat" label="What you want" summary={cfg.ai.preferences.trim().split("\n")[0] || "Not described yet"} onClick={() => setPage("prefs")} />
          <Row icon="memory" label="Memory" value={`${cfg.ai.memory.length} rule${cfg.ai.memory.length === 1 ? "" : "s"}`} onClick={() => setPage("memory")} />
          <Row icon="sliders" label="Model and cost" summary={modelSum} onClick={() => setPage("model")} />
          <Row icon="key" label="API key" value={keyStatus.set ? `Set · ${keyStatus.hint}` : "Missing"}
            valueClass={keyStatus.set ? "good" : "bad"} onClick={() => setPage("key")} />
        </div>
      </div>

      <div className="group">
        <div className="glabel">Sources and data</div>
        <div className="list">
          <Row icon="globe" label="Sites" summary={sitesSum} onClick={() => setPage("sites")} />
          <Row icon="wrench" label="Advanced" summary="Pages, delays, database" onClick={() => setPage("advanced")} />
        </div>
      </div>

      <div className="group">
        <div className="glabel">This device</div>
        <div className="list">
          <Row icon="moon" label="Theme" value={THEME_LABEL[theme]} onClick={() => setAppSheet("theme")} />
          {!isStandalone() && (
            <Row icon="phone" label="Add to home screen" summary="Open rentme like an app" onClick={() => setAppSheet("install")} />
          )}
        </div>
      </div>
      {saveBar}

      {appSheet === "theme" && (
        <Choice title="Theme" value={theme} onClose={() => setAppSheet("")}
          onPick={t => { setTheme(t); setThemeState(t); }}
          options={(Object.keys(THEME_LABEL) as Theme[]).map(t => ({ value: t, label: THEME_LABEL[t] }))} />
      )}
      {appSheet === "install" && (
        <Sheet title="Add to home screen" onClose={() => setAppSheet("")} closeButton>
          <div className="body">
            {canInstall ? (
              <button className="btn primary block" onClick={async () => { await promptInstall(); setAppSheet(""); }}>
                <Icon name="phone" size={18} />Install rentme
              </button>
            ) : isIOS() ? (
              <ol className="howto">
                <li>Open this page in <b>Safari</b>.</li>
                <li>Tap <b>Share</b> <Icon name="share" size={16} /> at the bottom of the screen.</li>
                <li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
              </ol>
            ) : (
              <ol className="howto">
                <li>Open the browser menu <Icon name="more" size={16} /> (top right in Chrome).</li>
                <li>Tap <b>Add to Home screen</b> (or <b>Install app</b>), then <b>Add</b>.</li>
              </ol>
            )}
            <span className="hint">
              It opens full screen with its own icon. The computer running rentme must be on and on the same Wi-Fi, as now.
            </span>
          </div>
        </Sheet>
      )}
    </div>
  );
}
