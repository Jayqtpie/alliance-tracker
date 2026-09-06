"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useLanguage } from "./language-selector";

const key = "rscl-theme";
const eventName = "rscl-theme-change";

function subscribe(onChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const sync = () => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(key); } catch { /* Storage can be disabled. */ }
    document.documentElement.dataset.theme = saved === "dark" || saved === "light" ? saved : "dark";
    onChange();
  };
  window.addEventListener(eventName, onChange);
  window.addEventListener("storage", sync);
  media.addEventListener("change", sync);
  return () => {
    window.removeEventListener(eventName, onChange);
    window.removeEventListener("storage", sync);
    media.removeEventListener("change", sync);
  };
}

export function ThemeToggle() {
  const { t } = useLanguage();
  const theme = useSyncExternalStore(subscribe, () => document.documentElement.dataset.theme === "dark" ? "dark" : "light", () => "dark");
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(key, next); } catch { /* The toggle still works without persistence. */ }
    window.dispatchEvent(new Event(eventName));
  }
  return <button className="theme-toggle" type="button" onClick={toggle} aria-label={t(theme === "dark" ? "Switch to light mode" : "Switch to dark mode")} title={t(theme === "dark" ? "Switch to light mode" : "Switch to dark mode")}>
    {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}<span>{t(theme === "dark" ? "Light mode" : "Dark mode")}</span>
  </button>;
}
