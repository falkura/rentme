/** Theme and home-screen helpers. The theme is a per-device choice, kept in this browser. */
export type Theme = "system" | "light" | "dark";
const KEY = "rentme.theme";
const BG = { light: "#f5f4f0", dark: "#151514" };

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

/** Set data-theme on <html> and the browser / status-bar color. */
export function applyTheme(t: Theme = getTheme()) {
  const root = document.documentElement;
  if (t === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
  const dark = t === "dark" || (t === "system" && systemDark());
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = dark ? BG.dark : BG.light;
}

export function setTheme(t: Theme) {
  try {
    if (t === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch { /* storage blocked: applies for this visit only */ }
  applyTheme(t);
}

// follow the phone's setting live while on "system"
window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => applyTheme());

/** Chrome/Android offers a real install prompt (only on https or localhost); keep it for the Settings button. */
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  deferred = e as InstallEvent;
  listeners.forEach(f => f());
});
window.addEventListener("appinstalled", () => { deferred = null; listeners.forEach(f => f()); });

export const canPromptInstall = () => deferred !== null;
export const onInstallChange = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  return outcome === "accepted";
}

export const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
