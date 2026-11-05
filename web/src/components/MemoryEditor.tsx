import { useState } from "react";
import { Icon } from "./ui";

/** Editable list of standing instructions for the AI assistant. */
export default function MemoryEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (t) onChange([...value, t]);
    setDraft("");
  };
  return (
    <div className="memory">
      {value.length === 0 && <div className="muted small">Nothing remembered yet. You can also say “remember …” in AI search.</div>}
      {value.map((m, i) => (
        <div key={i} className="memItem">
          <textarea className="input" rows={Math.min(5, Math.max(1, Math.ceil(m.length / 40)))} value={m}
            onChange={e => onChange(value.map((x, j) => (j === i ? e.target.value : x)))} />
          <button type="button" className="btn ghost icon" aria-label="Delete rule" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <Icon name="trash" size={18} />
          </button>
        </div>
      ))}
      <div className="memItem">
        <textarea className="input" rows={1} value={draft} placeholder="New rule, e.g. “Answer in Ukrainian"
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); add(); } }} />
        <button type="button" className="btn" disabled={!draft.trim()} onClick={add}>Add</button>
      </div>
    </div>
  );
}
