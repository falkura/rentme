import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** The rentme icon set: 24px grid, 1.75 stroke, currentColor (same as the design system). */
const P: Record<string, ReactNode> = {
  photos: <><rect x="3" y="4.5" width="18" height="15" rx="2" /><circle cx="8.5" cy="9.5" r="1.5" /><path d="M21 15.5l-5-5-9.5 9" /></>,
  map: <><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  star: <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  more: <><circle cx="5" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="19" cy="12" r="1.4" fill="currentColor" /></>,
  refresh: <><path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 4v5h-5" /></>,
  list: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" strokeWidth="2.6" /></>,
  chat: <path d="M4 5h16v11H9.5L5 20v-4H4z" />,
  sliders: <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  note: <><path d="M5 19h4L19.5 8.5l-4-4L5 15z" /><path d="M13.5 6.5l4 4" /></>,
  text: <path d="M5 6h14M5 10h14M5 14h14M5 18h8" />,
  tag: <><path d="M3.5 12.5V4h8.5l9 9-8.5 8.5z" /><circle cx="8" cy="8.5" r="1.3" /></>,
  eye: <><path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" /><circle cx="12" cy="12" r="2.5" /></>,
  external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v5H5V6h5" /></>,
  down: <path d="M6 9l6 6 6-6" />,
  right: <path d="M9 6l6 6-6 6" />,
  left: <path d="M15 6l-6 6 6 6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  send: <path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" />,
  bookmark: <path d="M6 4h12v16l-6-4.2L6 20z" />,
  memory: <><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z" /></>,
  undo: <><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3M14.5 8.5l2 2" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17" /></>,
  wrench: <path d="M14.5 5.5a4 4 0 0 0 5 5l-9 9a2.1 2.1 0 0 1-3-3l9-9a4 4 0 0 1-2-2z" />,
  compact: <path d="M4 7h16M4 12h16M4 17h16" />,
  expand: <><rect x="4" y="4" width="16" height="7" rx="1.5" /><rect x="4" y="14" width="16" height="6" rx="1.5" /></>,
  home: <><path d="M4 11l8-6.5 8 6.5" /><path d="M6 9.5V20h12V9.5" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />,
  trash: <path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13" />,
  edit: <><path d="M5 19h4L19.5 8.5l-4-4L5 15z" /></>,
  moon: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" />,
  phone: <><rect x="7" y="3" width="10" height="18" rx="2" /><path d="M11 17.5h2" /></>,
  share: <><path d="M12 15V4M8 7.5L12 3.5l4 4" /><path d="M7 11H5.5v9.5h13V11H17" /></>,
};
export type IconName = keyof typeof P;

export function Icon({ name, size = 20, filled = false }: { name: string; size?: number; filled?: boolean }) {
  return (
    <svg className="ic" viewBox="0 0 24 24" width={size} height={size} fill={filled ? "currentColor" : "none"} stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[name]}</svg>
  );
}

/** The one overlay pattern: a sheet rising from the bottom. Tap the dim area or press Escape to close. */
export function Sheet({ title, onClose, children, closeButton = false }: {
  title?: ReactNode; onClose: () => void; children: ReactNode; closeButton?: boolean;
}) {
  const close = useRef(onClose);
  close.current = onClose;
  const ref = useRef<HTMLDivElement>(null);
  const dragged = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close.current(); };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Swipe down to close: from the handle/header always, from the content when it is scrolled to the top.
    const el = ref.current!;
    let y0 = 0, t0 = 0, dy = 0, mode: "" | "drag" | "scroll" = "", fromGrab = false;
    const start = (e: TouchEvent) => {
      const t = e.target as Element;
      fromGrab = !!t.closest(".grab, .head");
      mode = !fromGrab && t.closest("textarea, input, .photos") ? "scroll" : "";
      y0 = e.touches[0].clientY; dy = 0; dragged.current = false;
    };
    const move = (e: TouchEvent) => {
      const y = e.touches[0].clientY;
      if (!mode) {
        if (Math.abs(y - y0) < 6) return;
        mode = y > y0 && (fromGrab || el.scrollTop <= 0) ? "drag" : "scroll";
        y0 = y; t0 = Date.now();
        el.style.transition = "none";
      }
      if (mode !== "drag") return;
      e.preventDefault();
      dy = Math.max(0, y - y0);
      dragged.current = true;
      el.style.transform = `translateY(${dy}px)`;
    };
    const end = () => {
      if (mode !== "drag") { mode = ""; return; }
      mode = "";
      const fast = dy / Math.max(1, Date.now() - t0) > 0.5;
      el.style.transition = "transform .16s ease-out";
      if (dy > 90 || (dy > 30 && fast)) {
        el.style.transform = "translateY(100%)";
        setTimeout(() => close.current(), 160);
      } else {
        el.style.transform = "";
      }
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      window.removeEventListener("keydown", onKey); document.body.style.overflow = overflow;
      el.removeEventListener("touchstart", start); el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end); el.removeEventListener("touchcancel", end);
    };
  }, []);
  return createPortal(
    <div className="scrim" onClick={onClose}>
      <div className="sheet" ref={ref} role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <button type="button" className="grab" aria-label="Close" onClick={() => { if (!dragged.current) onClose(); }}>
          <span className="handle" />
        </button>
        {(title || closeButton) && (
          <div className="head">
            <b>{title}</b>
            {closeButton && <button className="btn ghost icon" aria-label="Close" onClick={onClose}><Icon name="x" /></button>}
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** A radio list inside a sheet: picks one value and closes. */
export function Choice<T extends string>({ title, value, options, onPick, onClose }: {
  title: string; value: T; options: { value: T; label: string; count?: number }[];
  onPick: (v: T) => void; onClose: () => void;
}) {
  return (
    <Sheet title={title} onClose={onClose}>
      {options.map(o => (
        <button key={o.value} className="item" onClick={() => { onPick(o.value); onClose(); }} aria-pressed={o.value === value}>
          <span className="check">{o.value === value && <Icon name="check" />}</span>
          {o.label}
          {o.count !== undefined && <small>{o.count}</small>}
        </button>
      ))}
    </Sheet>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button type="button" className="switch" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

/** Bottom message with one action (Undo). Hides itself after `ms`. */
export function Snackbar({ text, action, onAction, onDone, ms = 5000 }: {
  text: string; action?: string; onAction?: () => void; onDone: () => void; ms?: number;
}) {
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => { const t = setTimeout(() => done.current(), ms); return () => clearTimeout(t); }, [text, ms]);
  return createPortal(
    <div className="snack" role="status">
      <span>{text}</span>
      {action && <button onClick={() => { onAction?.(); onDone(); }}>{action}</button>}
    </div>,
    document.body,
  );
}

/** Ask the rest of the app (the Update pill) to start an update. */
export const requestUpdate = () => window.dispatchEvent(new Event("rentme:start-update"));
