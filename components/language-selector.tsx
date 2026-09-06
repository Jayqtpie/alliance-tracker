"use client";

import { useEffect, useId, useSyncExternalStore } from "react";
import { ChevronDown, Globe } from "lucide-react";
import { isLanguage, languageDirection, LANGUAGE_OPTIONS, translate, type Language, type TranslationValues } from "@/lib/i18n";

export const LANGUAGE_STORAGE_KEY = "rscl-interface-language";
const listeners = new Set<() => void>();
let currentLanguage: Language | undefined;

function getSnapshot(): Language {
  if (currentLanguage !== undefined) return currentLanguage;
  if (typeof window === "undefined") return "en";
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    currentLanguage = isLanguage(stored) ? stored : "en";
  } catch {
    currentLanguage = "en";
  }
  return currentLanguage;
}

function notify() {
  listeners.forEach((listener) => listener());
}

function handleStorage(event: StorageEvent) {
  if (event.key !== LANGUAGE_STORAGE_KEY && event.key !== null) return;
  try {
    if (event.storageArea !== window.localStorage) return;
  } catch {
    return;
  }
  currentLanguage = isLanguage(event.newValue) ? event.newValue : "en";
  notify();
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    // Refresh cross-tab changes made while unmounted, retaining an in-memory
    // selection if this browser does not permit persistent storage.
    try {
      const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
      currentLanguage = isLanguage(stored) ? stored : "en";
    } catch {
      currentLanguage ??= "en";
    }
    window.addEventListener("storage", handleStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", handleStorage);
  };
}

function setLanguage(language: Language) {
  if (!isLanguage(language)) return;
  currentLanguage = language;
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // The selector still works for this session when browser storage is blocked.
  }
  notify();
}

const getServerSnapshot = (): Language => "en";

export function useLanguage() {
  const language = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { language, setLanguage, t: (phrase: string, values?: TranslationValues) => translate(language, phrase, values) };
}

export function LanguageSelector() {
  const { language, setLanguage, t } = useLanguage();
  const id = useId();

  useEffect(() => {
    const root = document.documentElement;
    const previousLanguage = root.lang;
    const previousDirection = root.getAttribute("dir");
    root.lang = language;
    root.dir = languageDirection(language);
    return () => {
      root.lang = previousLanguage;
      if (previousDirection === null) root.removeAttribute("dir");
      else root.setAttribute("dir", previousDirection);
    };
  }, [language]);

  return (
    <div className="language-selector" lang={language} dir={languageDirection(language)}>
      <label htmlFor={id}>{t("Language")}</label>
      <div className="language-control">
        <Globe size={17} aria-hidden="true" />
        <select id={id} value={language} onChange={(event) => { if (isLanguage(event.target.value)) setLanguage(event.target.value); }}>
          {LANGUAGE_OPTIONS.map((option) => <option key={option.code} value={option.code} lang={option.code}>{option.name}</option>)}
        </select>
        <ChevronDown size={14} aria-hidden="true" />
      </div>
    </div>
  );
}
