"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useLanguage } from "./language-selector";
import { resolvedTheme, themePreference, type ThemePreference } from "@/lib/theme";

const key = "rscl-theme";
const eventName = "rscl-theme-change";

function subscribe(onChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const sync = () => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme(themePreference(root.dataset.themePreference), media.matches);
    onChange();
  };
  const syncStorage = (event: StorageEvent) => {
    if (event.key !== key && event.key !== null) return;
    document.documentElement.dataset.themePreference = themePreference(event.newValue);
    sync();
  };
  window.addEventListener(eventName, sync);
  window.addEventListener("storage", syncStorage);
  media.addEventListener("change", sync);
  sync();
  return () => {
    window.removeEventListener(eventName, sync);
    window.removeEventListener("storage", syncStorage);
    media.removeEventListener("change", sync);
  };
}

export function ThemeToggle() {
  const { t } = useLanguage();
  const preference = useSyncExternalStore(subscribe, () => themePreference(document.documentElement.dataset.themePreference), () => "system");
  function selectTheme(next: ThemePreference) {
    document.documentElement.dataset.themePreference = next;
    document.documentElement.dataset.theme = resolvedTheme(next, window.matchMedia("(prefers-color-scheme: dark)").matches);
    try { localStorage.setItem(key, next); } catch { /* The selection still works without persistence. */ }
    window.dispatchEvent(new Event(eventName));
  }
  return <label className="theme-toggle theme-selector" title={t("Theme")}>
    {preference === "system" ? <Monitor size={17} /> : preference === "dark" ? <Moon size={17} /> : <Sun size={17} />}
    <select aria-label={t("Theme")} value={preference} onChange={(event) => selectTheme(themePreference(event.target.value))}>
      <option value="system">{t("System")}</option>
      <option value="light">{t("Light mode")}</option>
      <option value="dark">{t("Dark mode")}</option>
    </select>
  </label>;
}
