import { useState } from "react";
import { api } from "../api";

/** Score every "new" listing again from scratch, e.g. after rewriting your preferences. Two steps: count, then confirm. */
export default function RescoreNew({ dirty }: { dirty: boolean }) {
  const [info, setInfo] = useState<{ count: number; without_details: number; model: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const ask = async () => {
    setMsg(null); setBusy(true);
    try { setInfo(await api.rescoreNewCount()); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    setBusy(false);
  };
  const go = async () => {
    setBusy(true);
    try {
      const r = await api.rescoreNew();
      if (r.started) {
        window.dispatchEvent(new Event("rentme:update-started"));
        setMsg({ ok: true, text: "Started. Progress is in the top bar; you can stop it there." });
      } else {
        setMsg({ ok: false, text: "An update is already running. Try again when it finishes." });
      }
      setInfo(null);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
    setBusy(false);
  };

  return (
    <div className="field rescore">
      <div className="flabel">Re-review new listings</div>
      <div className="hint">
        Scores every listing still marked <b>New</b> again from scratch, ignoring old scores and the per-update cap.
        Useful after you rewrite what you want.{dirty && <b> Save your settings first: it uses the saved ones.</b>}
      </div>
      {info === null ? (
        <button className="btn sm" disabled={busy} onClick={ask}>{busy ? "Counting…" : "Re-review all new"}</button>
      ) : info.count === 0 ? (
        <div className="hint">No new listings to review. <button className="btn ghost sm" onClick={() => setInfo(null)}>OK</button></div>
      ) : (
        <div className="confirm">
          <span>
            Re-review <b>{info.count}</b> listing{info.count === 1 ? "" : "s"} with {info.model}?
            {info.without_details > 0 && <> {info.without_details} need their details fetched first.</>}
            {" "}This uses API credits.
          </span>
          <div className="row">
            <button className="btn sm primary" disabled={busy} onClick={go}>Re-review {info.count}</button>
            <button className="btn sm ghost" disabled={busy} onClick={() => setInfo(null)}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <div className={"small " + (msg.ok ? "ok" : "err")}>{msg.text}</div>}
    </div>
  );
}
