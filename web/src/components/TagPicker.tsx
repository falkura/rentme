import { Icon } from "./ui";

/** Tri-state tag chips: tap = require, again = exclude, again = ignore. */
export type TagState = Record<string, 1 | -1>;

export default function TagPicker({ tags, value, onChange, triState = true }: {
  tags: Record<string, string>;
  value: TagState;
  onChange: (v: TagState) => void;
  triState?: boolean;
}) {
  const click = (t: string) => {
    const next = { ...value };
    const cur = next[t];
    if (cur === undefined) next[t] = 1;
    else if (cur === 1 && triState) next[t] = -1;
    else delete next[t];
    onChange(next);
  };
  return (
    <div className="chips">
      {Object.entries(tags).map(([k, label]) => (
        <button type="button" key={k} onClick={() => click(k)}
          className={"chip" + (value[k] === 1 ? " on" : value[k] === -1 ? " off" : "")}
          aria-label={`${label}: ${value[k] === 1 ? "required" : value[k] === -1 ? "excluded" : "ignored"}`}>
          {value[k] === 1 && <Icon name="check" size={14} />}{value[k] === -1 && <Icon name="x" size={14} />}{label}
        </button>
      ))}
    </div>
  );
}

export const toTagState = (req: string[], exc: string[]): TagState =>
  Object.fromEntries([...req.map(t => [t, 1] as const), ...exc.map(t => [t, -1] as const)]);

export const fromTagState = (s: TagState) => ({
  required: Object.keys(s).filter(k => s[k] === 1),
  excluded: Object.keys(s).filter(k => s[k] === -1),
});
