import { useState } from "react";
import { api } from "../api";
import { Icon, Sheet } from "./ui";

type Info = { count: number; without_details: number; model: string };

/** Score every "new" listing again from scratch, e.g. after rewriting your preferences.
 *  A settings row that opens a sheet: it counts first, then you confirm. */
export default function RescoreNew({ dirty, models = [] }: { dirty: boolean; models?: { id: string; label: string }[] }) {
  const modelName = (id: string) => models.find(m => m.id === id)?.label.replace(/\s*\(.*\)$/, "") || id;
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const openSheet = async () => {
    setOpen(true); setInfo(null); setErr("");
    if (dirty) return;
    setBusy(true);
    try { setInfo(await api.rescoreNewCount()); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };
  const go = async () => {
    setBusy(true); setErr("");
    try {
      const r = await api.rescoreNew();
      if (r.started) {
        window.dispatchEvent(new Event("rentme:update-started"));
        setOpen(false);
      } else {
        setErr("An update is already running. Try again when it finishes.");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };
  const n = info?.count ?? 0;

  return (
    <>
      <div className="list flush">
        <button className="listrow" onClick={openSheet}>
          <Icon name="refresh" />
          <span className="txt">Re-review new listings<small>Score everything marked New again</small></span>
          <Icon name="right" size={18} />
        </button>
      </div>

      {open && (
        <Sheet title="Re-review new listings" onClose={() => setOpen(false)}>
          <div className="body">
            {dirty ? (
              <p className="sheetText">You have unsaved changes. Save your settings first: the re-review uses the saved ones.</p>
            ) : busy && !info ? (
              <p className="sheetText muted"><span className="spin" /> Counting…</p>
            ) : info && n === 0 ? (
              <p className="sheetText">No listings are marked New right now.</p>
            ) : info ? (
              <p className="sheetText">
                Score the <b>{n}</b> listing{n === 1 ? "" : "s"} marked New again from scratch with <b>{modelName(info.model)}</b>.
                Old scores are replaced, and the per-update limit doesn't apply.
                {info.without_details > 0 && <> {info.without_details} need their details downloaded first.</>}
                <span className="hint"> This uses API credits. Progress shows on the Update button.</span>
              </p>
            ) : null}
            {err && <p className="sheetText err">{err}</p>}
          </div>
          <div className="foot">
            <button className="btn" onClick={() => setOpen(false)}>{n > 0 ? "Cancel" : "Close"}</button>
            <button className="btn primary" disabled={busy || dirty || n === 0} onClick={go}>
              {n > 0 ? `Re-review ${n}` : "Re-review"}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
