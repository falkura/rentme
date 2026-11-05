import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Otodom/OLX CDN urls carry the size as ";s=WxH" - ask for a big version in the viewer. */
export const bigUrl = (u: string) => u.replace(/;s=\d+x\d+/, ";s=1280x1024");

type Zoom = { s: number; x: number; y: number; anim: boolean };
const NONE: Zoom = { s: 1, x: 0, y: 0, anim: true };
const MAX = 5;
const DOUBLE = 2.5;

export default function Lightbox({ urls, index, onIndex, onClose, title }: {
  urls: string[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  title?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [z, setZ] = useState<Zoom>(NONE);
  const zr = useRef(z);
  zr.current = z;
  const img = useRef<HTMLImageElement>(null);
  const touchX = useRef<number | null>(null);
  const pinched = useRef(false); // this touch sequence zoomed or panned: it is not a swipe
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const g = useRef<{ d0: number; s0: number; x0: number; y0: number; mx: number; my: number; cx: number; cy: number } | null>(null);
  const pan = useRef<{ px: number; py: number; x0: number; y0: number } | null>(null);
  const tap = useRef({ t: 0, x: 0, y: 0, moved: false });
  const n = urls.length;
  const go = (d: number) => onIndex((index + d + n) % n);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; };
  });

  // preload neighbours so switching is instant; a new photo starts unzoomed
  useEffect(() => {
    setLoaded(false);
    setZ(NONE);
    for (const d of [1, -1]) new Image().src = bigUrl(urls[(index + d + n) % n]);
  }, [index, urls, n]);

  /** the image centre as if it were not zoomed or moved */
  const centre = () => {
    const r = img.current!.getBoundingClientRect();
    return { cx: r.left + r.width / 2 - zr.current.x, cy: r.top + r.height / 2 - zr.current.y };
  };
  /** keep the zoomed photo covering its own frame: no panning it off into the void */
  const clamp = (s: number, x: number, y: number, anim = false): Zoom => {
    s = Math.min(MAX, Math.max(1, s));
    if (s <= 1.01) return { ...NONE, anim };
    const el = img.current!;
    const lx = (el.offsetWidth * (s - 1)) / 2, ly = (el.offsetHeight * (s - 1)) / 2;
    return { s, x: Math.max(-lx, Math.min(lx, x)), y: Math.max(-ly, Math.min(ly, y)), anim };
  };
  /** zoom to scale s keeping screen point (px, py) still */
  const zoomAt = (s: number, px: number, py: number, anim: boolean) => {
    const { cx, cy } = centre();
    const c = zr.current;
    const k = Math.min(MAX, Math.max(1, s)) / c.s;
    setZ(clamp(s, px - cx - (px - cx - c.x) * k, py - cy - (py - cy - c.y) * k, anim));
  };

  const onDown = (e: React.PointerEvent) => {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 1) {
      tap.current.moved = false;
      if (zr.current.s > 1) pan.current = { px: e.clientX, py: e.clientY, x0: zr.current.x, y0: zr.current.y };
    } else if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      pinched.current = true;
      pan.current = null;
      g.current = {
        d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: zr.current.s, x0: zr.current.x, y0: zr.current.y,
        mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, ...centre(),
      };
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const p = pts.current.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    const t = tap.current;
    if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > 10) t.moved = true;
    if (g.current && pts.current.size >= 2) {
      const [a, b] = [...pts.current.values()];
      const G = g.current;
      const s = Math.min(MAX, Math.max(1, (G.s0 * Math.hypot(a.x - b.x, a.y - b.y)) / G.d0));
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, k = s / G.s0;
      setZ(clamp(s, mx - G.cx - (G.mx - G.cx - G.x0) * k, my - G.cy - (G.my - G.cy - G.y0) * k));
    } else if (pan.current) {
      const P = pan.current;
      pinched.current = true;
      setZ(clamp(zr.current.s, P.x0 + e.clientX - P.px, P.y0 + e.clientY - P.py));
    }
  };
  const onUp = (e: React.PointerEvent) => {
    pts.current.delete(e.pointerId);
    if (pts.current.size < 2) g.current = null;
    if (pts.current.size === 1 && zr.current.s > 1) { // one finger left after a pinch: keep panning with it
      const [p] = [...pts.current.values()];
      pan.current = { px: p.x, py: p.y, x0: zr.current.x, y0: zr.current.y };
    }
    if (pts.current.size > 0) return;
    pan.current = null;
    // double tap / double click toggles zoom at that spot
    const t = tap.current, now = e.timeStamp;
    if (!t.moved && now - t.t < 300 && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 30) {
      if (zr.current.s > 1) setZ(NONE);
      else zoomAt(DOUBLE, e.clientX, e.clientY, true);
      t.t = 0;
    } else if (!t.moved) {
      Object.assign(t, { t: now, x: e.clientX, y: e.clientY });
    }
  };

  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const zoomed = z.s > 1;

  return createPortal(
    <div className="lb" onClick={() => { if (!zoomed) onClose(); }} role="dialog" aria-modal="true"
      onTouchStart={e => {
        // scrolling the thumbnail strip (or touching the top bar) is not a swipe to the next photo
        if ((e.target as Element).closest(".lbStrip, .lbTop")) { touchX.current = null; return; }
        if (e.touches.length === 1) { touchX.current = e.touches[0].clientX; pinched.current = false; }
      }}
      onTouchEnd={e => {
        if (touchX.current == null || e.touches.length > 0) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (!pinched.current && !zoomed && Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
      }}>
      <div className="lbTop" onClick={stop}>
        <span className="lbCount">{index + 1} / {n}</span>
        {title && <span className="lbTitle">{title}</span>}
        {zoomed && <button className="lbBtn small" onClick={() => setZ(NONE)} title="Back to fit">1:1</button>}
        <a className={"lbBtn small" + (zoomed ? " near" : "")} href={bigUrl(urls[index])} target="_blank" rel="noreferrer" title="Open original">↗</a>
        <button className="lbBtn" onClick={onClose} aria-label="Close">✕</button>
      </div>

      {n > 1 && !zoomed && <button className="lbBtn lbNav prev" onClick={e => { stop(e); go(-1); }} aria-label="Previous">‹</button>}
      {!loaded && <span className="spin lbSpin" />}
      <img ref={img} key={urls[index]} className={"lbImg" + (loaded ? " in" : "") + (zoomed ? " zoomed" : "")}
        src={bigUrl(urls[index])} referrerPolicy="no-referrer" alt="" draggable={false}
        title="Double-click or pinch to zoom"
        style={{ transform: `translate(${z.x}px, ${z.y}px) scale(${z.s})`, transition: z.anim ? undefined : "opacity .15s" }}
        onClick={stop} onLoad={() => setLoaded(true)}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onWheel={e => zoomAt(zr.current.s * Math.exp(-e.deltaY * 0.002), e.clientX, e.clientY, false)}
        onError={e => { const el = e.currentTarget; if (el.src !== urls[index]) el.src = urls[index]; }} />
      {n > 1 && !zoomed && <button className="lbBtn lbNav next" onClick={e => { stop(e); go(1); }} aria-label="Next">›</button>}

      {n > 1 && (
        <div className="lbStrip" onClick={stop}>
          {urls.map((u, i) => (
            <img key={u} src={u} loading="lazy" referrerPolicy="no-referrer" alt=""
              className={i === index ? "on" : ""} onClick={() => onIndex(i)} />
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
