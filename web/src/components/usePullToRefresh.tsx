import { useEffect, useRef, useState } from "react";
import { Icon } from "./ui";

const THRESHOLD = 64; // px of (damped) pull needed to refresh
const MAX = 110;

/** Phone-style pull-to-refresh on the page itself: at the very top, drag down and let go. */
export function usePullToRefresh(onRefresh: () => Promise<unknown>) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const cb = useRef(onRefresh);
  cb.current = onRefresh;

  useEffect(() => {
    let st: { x: number; y: number; active: boolean } | null = null;
    let dist = 0;
    let running = false;

    const start = (e: TouchEvent) => {
      st = null;
      if (running || e.touches.length !== 1 || window.scrollY > 0) return;
      // not from overlays, inputs or sideways-scrolling strips
      if ((e.target as Element).closest(".lb, .sheet, .snack, input, textarea, select, .photos, [data-no-pull]")) return;
      st = { x: e.touches[0].clientX, y: e.touches[0].clientY, active: false };
    };
    const move = (e: TouchEvent) => {
      if (!st) return;
      const dy = e.touches[0].clientY - st.y, dx = e.touches[0].clientX - st.x;
      if (!st.active) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;           // not decided yet
        if (dy <= 0 || Math.abs(dx) > dy || window.scrollY > 0) { st = null; return; } // a normal scroll
        st.active = true;
      }
      e.preventDefault(); // we own this gesture now: no page bounce, no scroll
      dist = Math.max(0, Math.min(MAX, dy * 0.5));
      setPull(dist);
    };
    const end = async () => {
      const was = st?.active;
      st = null;
      if (!was) return;
      if (dist < THRESHOLD) { dist = 0; setPull(0); return; }
      running = true;
      setBusy(true);
      setPull(THRESHOLD * 0.75);
      const minSpin = new Promise(r => setTimeout(r, 450)); // long enough to see that it happened
      try { await Promise.all([cb.current(), minSpin]); } catch { /* the list keeps what it had */ }
      running = false;
      dist = 0;
      setBusy(false);
      setPull(0);
    };

    document.addEventListener("touchstart", start, { passive: true });
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", end);
    document.addEventListener("touchcancel", end);
    return () => {
      document.removeEventListener("touchstart", start);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", end);
      document.removeEventListener("touchcancel", end);
    };
  }, []);

  return { pull, busy, ready: pull >= THRESHOLD };
}

/** The round indicator that slides down from under the top bar. */
export function PullIndicator({ pull, busy, ready }: { pull: number; busy: boolean; ready: boolean }) {
  if (pull <= 0 && !busy) return null;
  return (
    <div className={"ptr" + (ready || busy ? " ready" : "") + (pull === 0 || busy ? "" : " dragging")}
      style={{ transform: `translate(-50%, ${pull - 44}px)`, opacity: Math.min(1, pull / 40) }}
      role="status" aria-label={busy ? "Refreshing" : ready ? "Release to refresh" : "Pull to refresh"}>
      {busy
        ? <span className="spin" />
        : <span style={{ transform: `rotate(${(pull / THRESHOLD) * 270}deg)`, display: "grid" }}><Icon name="refresh" size={18} /></span>}
    </div>
  );
}
