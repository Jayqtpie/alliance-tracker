export type ThemePreference = "system" | "light" | "dark";

export function themePreference(value: string | null | undefined): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolvedTheme(preference: ThemePreference, systemDark: boolean) {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference;
}

// Run in the head before the page paints, including when storage is blocked.
export const themeInitializationScript = `(function(){var t;try{t=localStorage.getItem('rscl-theme')}catch(e){}var p=t==='light'||t==='dark'?t:'system';var r=document.documentElement;r.dataset.themePreference=p;r.dataset.theme=p==='system'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p})()`;
