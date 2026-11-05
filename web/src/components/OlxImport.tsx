import { useState } from "react";
import { api } from "../api";

type Result = { offers: number; imported: number; otodom_mirrors_skipped: number; new: number; passing_filters: number };

/** OLX blocks scripts, but your own browser can open its API links. Save/copy the page here to import it. */
export default function OlxImport({ dirty }: { dirty: boolean }) {
  const [urls, setUrls] = useState<string[] | null>(null);
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [total, setTotal] = useState({ imported: 0, passing: 0 });
  const [ranking, setRanking] = useState(false);

  const showLinks = async () => setUrls((await api.olxUrls()).urls);

  const importText = async (texts: string[]) => {
    setBusy(true); setMsg(null);
    let imported = 0, passing = 0, skipped = 0, isNew = 0;
    try {
      for (const t of texts) {
        let data: unknown;
        try { data = JSON.parse(t); }
        catch { throw new Error("That isn't the OLX page text. Open an OLX link below, then save or copy the whole page."); }
        const r: Result = await api.olxImport(data);
        imported += r.imported; passing += r.passing_filters; skipped += r.otodom_mirrors_skipped; isNew += r.new;
      }
      setTotal(t => ({ imported: t.imported + imported, passing: t.passing + passing }));
      setMsg({ ok: true, text: `Imported ${imported} OLX listings (${isNew} new, ${passing} pass your filters`
        + `${skipped ? `, ${skipped} copies of Otodom ads skipped` : ""}).` });
      setPaste("");
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    await importText(await Promise.all([...files].map(f => f.text())));
  };

  const rankNow = async () => {
    setRanking(true);
    const r = await api.startUpdate(true, false);
    window.dispatchEvent(new Event("rentme:update-started"));
    if (!r.started) setMsg({ ok: false, text: "An update is already running; it will rank these too." });
  };

  return (
    <div className="olxImport">
      <h4>Import from OLX</h4>
      <ol>
        <li>
          Open the OLX link{urls && urls.length > 1 ? "s (one per page of 40)" : ""} in this browser. It shows a page of raw text, which is expected.
          {dirty && <span className="err"> Save your settings first: the links use the saved filters.</span>}
          <div className="row" style={{ marginTop: 6 }}>
            {urls === null
              ? <button className="btn sm" onClick={showLinks}>Show OLX links</button>
              : urls.map((u, i) => (
                <a key={u} className="btnLink" href={u} target="_blank" rel="noreferrer">Open OLX page {i + 1}</a>
              ))}
          </div>
        </li>
        <li>
          Computer: press <kbd>Ctrl</kbd>+<kbd>S</kbd> and upload the saved file(s) here.
          <div>
            <input type="file" accept=".json,.txt,application/json,text/plain" multiple disabled={busy}
              onChange={e => { onFiles(e.target.files); e.target.value = ""; }} />
          </div>
        </li>
        <li>
          Phone (or instead of saving): select all the text on that page, copy it and paste it here.
          <textarea rows={3} value={paste} placeholder='{"data":[{"id":…' disabled={busy}
            onChange={e => setPaste(e.target.value)} className="input" />
          <button disabled={busy || !paste.trim()} onClick={() => importText([paste])} className="btn sm" style={{ marginTop: 6 }}>
            {busy ? "Importing…" : "Import pasted text"}
          </button>
        </li>
      </ol>
      {msg && <div className={`small ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}
      {total.passing > 0 && (
        <div className="row">
          <button className="btn sm primary" disabled={ranking} onClick={rankNow}>
            {ranking ? "Ranking started" : `Rank with AI now`}
          </button>
          <span className="small muted">Scores the newly imported listings that pass your filters. Already-scored ones are not paid for again.</span>
        </div>
      )}
    </div>
  );
}
