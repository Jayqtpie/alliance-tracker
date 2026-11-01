// Temporary on-screen event log for diagnosing the member actions menu on iOS.
// Only active when the page URL contains ?debug=menu. Remove once the bug is found.

const enabled = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "menu";
const lines: string[] = [];
let panel: HTMLPreElement | null = null;
let started = 0;

function describe(target: EventTarget | null) {
  if (!(target instanceof Element)) return target ? String(target.constructor?.name ?? target) : "null";
  const label = target.getAttribute("aria-label") || target.textContent?.trim().slice(0, 18) || "";
  const where = target.closest(".member-actions-menu") ? " [in menu]" : "";
  return `${target.tagName.toLowerCase()}${target.classList[0] ? `.${target.classList[0]}` : ""}${label ? ` "${label}"` : ""}${where}`;
}

export function menuDebug(message: string) {
  if (!enabled) return;
  if (!panel) {
    panel = document.createElement("pre");
    panel.style.cssText = "position:fixed;z-index:2147483647;top:0;left:0;right:0;max-height:45vh;overflow:hidden;margin:0;padding:6px;font:10px/1.3 ui-monospace,monospace;white-space:pre-wrap;color:#0f0;background:#000d;pointer-events:none";
    document.body.appendChild(panel);
    started = performance.now();
  }
  lines.push(`${Math.round(performance.now() - started).toString().padStart(6)} ${message}`);
  if (lines.length > 40) lines.shift();
  panel.textContent = lines.join("\n");
}

if (enabled) {
  const install = () => {
    menuDebug(navigator.userAgent.replace(/^Mozilla\/5\.0 /, ""));
    for (const type of ["touchstart", "touchend", "touchcancel", "pointerdown", "pointerup", "pointercancel", "mousedown", "mouseup", "click"]) {
      document.addEventListener(type, (event) => menuDebug(`${type} -> ${describe(event.target)}${event.defaultPrevented ? " (prevented)" : ""}`), true);
    }
    document.addEventListener("focusin", (event) => menuDebug(`focusin -> ${describe(event.target)}`), true);
    document.addEventListener("focusout", (event) => menuDebug(`focusout ${describe(event.target)} -> ${describe(event.relatedTarget)}`), true);
    document.addEventListener("toggle", (event) => menuDebug(`toggle ${describe(event.target)} ${(event as ToggleEvent).newState}`), true);
    let lastScroll = 0;
    window.addEventListener("scroll", () => {
      if (performance.now() - lastScroll < 250) return;
      lastScroll = performance.now();
      menuDebug(`scroll y=${Math.round(window.scrollY)}`);
    }, true);
    window.addEventListener("resize", () => menuDebug(`resize ${window.innerWidth}x${window.innerHeight}`));
    window.addEventListener("error", (event) => menuDebug(`ERROR ${event.message}`));
    window.addEventListener("unhandledrejection", (event) => menuDebug(`REJECTION ${String(event.reason)}`));
  };
  if (document.body) install();
  else document.addEventListener("DOMContentLoaded", install);
}
