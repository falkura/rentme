import { useEffect, useRef, useState } from "react";
import { Icon } from "./ui";

/** Chat input. Keeps its own text state so typing re-renders only this box, not the whole conversation. */
export default function Composer({ busy, onSend, disabled = false, placeholder = "Ask about your listings" }: {
  busy: boolean; onSend: (text: string) => void; disabled?: boolean; placeholder?: string;
}) {
  const [input, setInput] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);

  // auto-grow with the content
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "";
    // empty, or measured while the tab is hidden (scrollHeight 0): keep the natural one-row height
    if (!input || !el.scrollHeight) return;
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`;
  }, [input]);

  const send = () => {
    const text = input.trim();
    if (!text || busy || disabled) return;
    onSend(text);
    setInput("");
  };
  // Enter sends on a keyboard; on a phone Enter makes a new line and the button sends
  const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

  return (
    <form className={"composer" + (busy ? " busy" : "")} onSubmit={e => { e.preventDefault(); send(); }}>
      <div className="composerBox" onClick={() => box.current?.focus()}>
        <textarea ref={box} value={input} rows={1} disabled={disabled} placeholder={placeholder}
          enterKeyHint={touch ? "enter" : "send"}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (!touch && e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
          }} />
        <button type="submit" className="send" disabled={busy || disabled || !input.trim()} aria-label="Send">
          {busy ? <span className="spin" /> : <Icon name="send" size={18} />}
        </button>
      </div>
    </form>
  );
}
