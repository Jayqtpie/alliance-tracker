import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { resolvedTheme, themeInitializationScript, themePreference } from "./theme";

describe("theme before first paint", () => {
  it.each([
    [null, true, "system", "dark"],
    [null, false, "system", "light"],
    ["system", true, "system", "dark"],
    ["system", false, "system", "light"],
    ["invalid", true, "system", "dark"],
    ["light", true, "light", "light"],
    ["dark", false, "dark", "dark"],
  ])("resolves saved %s with system dark=%s", (saved, systemDark, preference, theme) => {
    const root = { dataset: {} };
    runInNewContext(themeInitializationScript, {
      document: { documentElement: root },
      localStorage: { getItem: () => saved },
      window: { matchMedia: () => ({ matches: systemDark }) },
    });
    expect(root.dataset).toEqual({ themePreference: preference, theme });
    expect(resolvedTheme(themePreference(saved as string | null), Boolean(systemDark))).toBe(theme);
  });

  it("follows the system when browser storage is unavailable", () => {
    const root = { dataset: {} };
    runInNewContext(themeInitializationScript, {
      document: { documentElement: root },
      localStorage: { getItem: () => { throw new Error("Storage blocked"); } },
      window: { matchMedia: () => ({ matches: true }) },
    });
    expect(root.dataset).toEqual({ themePreference: "system", theme: "dark" });
  });

  it("updates a system theme while retaining an explicit override", () => {
    expect(resolvedTheme("system", true)).toBe("dark");
    expect(resolvedTheme("system", false)).toBe("light");
    expect(resolvedTheme("dark", false)).toBe("dark");
    expect(resolvedTheme("light", true)).toBe("light");
  });
});
