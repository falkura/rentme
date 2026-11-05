import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Icon, Sheet } from "./ui";

const LAST = "rentme.lastUpdate";

function ago(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
const readLast = () => { try { return Number(localStorage.getItem(LAST)) || null; } catch { return null; } };

/** The Update pill in the top bar: idle (last run) → running (progress, tap for log + Stop) → finished (N new). */
export default function UpdateButton({ onDone, newCount, onOpenNew }: {
  onDone: () => void; newCount: number | null; onOpenNew: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [last, setLast] = useState<number | null>(readLast);
  const [fresh, setFresh] = useState<number | null>(null); // the new-count before the run, while showing "N new"
  const before = useRef<number>(0);
  const timer = useRef<number>();
  const [, tick] = useState(0);

  useEffect(() => { const t = window.setInterval(() => tick(x => x + 1), 60000); return () => clearInterval(t); }, []);

  const finish = () => {
    window.clearInterval(timer.current);
    setRunning(false); setStopping(false);
    const now = Date.now();
    try { localStorage.setItem(LAST, String(now)); } catch { /* ignore */ }
    setLast(now);
    setFresh(before.current);
    onDone();
  };

  const poll = () => {
    window.clearInterval(timer.current);
    timer.current = window.setInterval(async () => {
      try {
        const s = await api.updateStatus();
        setLog(s.log); setStopping(s.stopping);
        if (!s.running) finish();
      } catch { /* server busy or restarting: try again */ }
    }, 1500);
  };

  const begin = () => {
    before.current = newCount ?? 0;
    setFresh(null); setRunning(true); setLog(["starting…"]); poll();
  };

  const start = async () => {
    begin();
    try { await api.startUpdate(); } catch (e) { setLog([`Could not start: ${e instanceof Error ? e.message : e}`]); }
  };

  // started elsewhere (chat, settings, OLX import) → show progress here; or asked to start (Save and update, setup)
  useEffect(() => {
    const onStarted = () => begin();
    const onStart = () => { if (!running) start(); };
    window.addEventListener("rentme:update-started", onStarted);
    window.addEventListener("rentme:start-update", onStart);
    return () => {
      window.removeEventListener("rentme:update-started", onStarted);
      window.removeEventListener("rentme:start-update", onStart);
    };
  });

  useEffect(() => {
    api.updateStatus().then(s => { if (s.running) { setRunning(true); setLog(s.log); poll(); } }).catch(() => {});
    return () => window.clearInterval(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = async () => {
    setStopping(true);
    await api.stopUpdate().catch(() => setStopping(false));
  };

  const lastLine = log.length ? log[log.length - 1] : "";
  const gained = fresh !== null && newCount !== null ? Math.max(0, newCount - fresh) : null;

  let pill;
  if (running) {
    pill = (
      <button className="update running" onClick={() => setOpen(true)} title="Show progress">
        <span className="spin" />{stopping ? "Stopping" : "Updating"}
        <small style={{ maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lastLine}</small>
      </button>
    );
  } else if (gained !== null) {
    pill = (
      <button className="update fresh" onClick={() => { setFresh(null); onOpenNew(); }} title="Show the newest listings">
        <Icon name="check" size={17} />{gained ? `${gained} new` : "Up to date"}<small>just now</small>
      </button>
    );
  } else {
    pill = (
      <button className="update" onClick={start} title="Download and rank new listings">
        <Icon name="refresh" size={17} />Update{last && <small>{ago(last)}</small>}
      </button>
    );
  }

  return (
    <>
      {pill}
      {open && (
        <Sheet title={running ? "Updating" : "Last update"} onClose={() => setOpen(false)} closeButton>
          <div className="body">
            <pre className="log">{log.join("\n") || "Nothing yet."}</pre>
            {running && (
              <button className="btn danger" disabled={stopping} onClick={stop}>
                <Icon name="stop" size={18} />{stopping ? "Stopping…" : "Stop update"}
              </button>
            )}
            <span className="hint">Stopping keeps everything fetched so far.</span>
          </div>
        </Sheet>
      )}
    </>
  );
}
