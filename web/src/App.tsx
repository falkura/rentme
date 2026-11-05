import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { KeyStatus, Meta } from "./types";
import Listings from "./components/Listings";
import Chat from "./components/Chat";
import SettingsPage from "./components/Settings";
import UpdateButton from "./components/UpdateButton";
import { Icon } from "./components/ui";

type Tab = "listings" | "chat" | "settings";
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "listings", label: "Listings", icon: "list" },
  { id: "chat", label: "AI search", icon: "chat" },
  { id: "settings", label: "Settings", icon: "sliders" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>(() => {
    const h = location.hash.slice(1);
    return (TABS.some(t => t.id === h) ? h : "listings") as Tab;
  });
  const [meta, setMeta] = useState<Meta | null>(null);
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<{ fresh: number; total: number } | null>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [showNewest, setShowNewest] = useState(0); // bumped by the "N new" pill: Listings jumps to New only

  useEffect(() => {
    api.meta().then(setMeta).catch(e => setError(String(e)));
    api.settings().then(s => setKeyStatus(s.api_key)).catch(() => {});
  }, []);
  useEffect(() => { history.replaceState(null, "", `#${tab}`); window.scrollTo(0, 0); }, [tab]);

  // phones: hide the tab bar while the keyboard is up (any text field focused)
  useEffect(() => {
    const isText = (el: EventTarget | null) =>
      el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !["checkbox", "radio", "file", "button"].includes(el.type));
    const on = (e: FocusEvent) => { if (isText(e.target) && window.innerWidth < 900) document.body.classList.add("typing"); };
    const off = () => document.body.classList.remove("typing");
    document.addEventListener("focusin", on);
    document.addEventListener("focusout", off);
    return () => { document.removeEventListener("focusin", on); document.removeEventListener("focusout", off); };
  }, []);

  const onCounts = useCallback((c: { fresh: number; total: number }) => setCounts(c), []);
  const reload = useCallback(() => setReloadToken(x => x + 1), []);

  if (error) return <div className="center"><p className="err">Cannot reach the rentme server: {error}</p></div>;
  if (!meta) return <div className="center">Loading…</div>;

  return (
    <>
      <header className="appbar">
        <div className="brand">rent<span>me</span></div>
        <nav className="tabbar" aria-label="Sections">
          {TABS.map(t => (
            <button key={t.id} className="tab" aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
              <Icon name={t.icon} size={22} />{t.label}
              {t.id === "listings" && !!counts?.fresh && <span className="count">{counts.fresh > 99 ? "99+" : counts.fresh}</span>}
              {t.id === "settings" && (settingsDirty || (keyStatus && !keyStatus.set)) && <span className="dot" title="Needs attention" />}
            </button>
          ))}
        </nav>
        <UpdateButton onDone={reload} newCount={counts?.fresh ?? null}
          onOpenNew={() => { setTab("listings"); setShowNewest(x => x + 1); }} />
      </header>
      <main className="page">
        <div hidden={tab !== "listings"}>
          <Listings meta={meta} reloadToken={reloadToken} onCounts={onCounts} showNewest={showNewest} />
        </div>
        <div hidden={tab !== "chat"}>
          <Chat meta={meta} keySet={keyStatus?.set ?? true} active={tab === "chat"} onOpenSettings={() => setTab("settings")} />
        </div>
        <div hidden={tab !== "settings"}>
          <SettingsPage meta={meta} keyStatus={keyStatus} onKeyChange={setKeyStatus} onSaved={reload}
            onDirty={setSettingsDirty} hasListings={(counts?.total ?? 0) > 0} />
        </div>
      </main>
    </>
  );
}
