import { describe, expect, it } from "vitest";
import { isLanguage, languageDirection, LANGUAGE_OPTIONS, translate, translations } from "./i18n";

describe("interface translations", () => {
  it("provides all selected languages and complete interpolation values", () => {
    expect(LANGUAGE_OPTIONS.map((option) => option.code)).toEqual(["en", "es", "fr", "de", "it", "ar", "th", "zh", "ko", "tr"]);
    for (const [source, row] of Object.entries(translations)) {
      expect(row).toHaveLength(LANGUAGE_OPTIONS.length - 1);
      const placeholders = [...source.matchAll(/\{\w+\}/g)].map(([match]) => match).sort();
      for (const translated of row) {
        expect(translated.trim().length).toBeGreaterThan(0);
        expect([...translated.matchAll(/\{\w+\}/g)].map(([match]) => match).sort()).toEqual(placeholders);
      }
    }
  });

  it("keeps user content intact and safely substitutes full sentences", () => {
    expect(translate("fr", "An imported member name")).toBe("An imported member name");
    expect(translate("en", "Median {value}", { value: "2.5m" })).toBe("Median 2.5m");
    expect(translate("de", "{count} of {total} active members captured", { count: 5, total: 10 })).toBe("5 von 10 aktiven Mitgliedern erfasst");
    expect(translate("en", "{missing}")).toBe("{missing}");
    expect(translate("en", "{toString}")).toBe("{toString}");
  });

  it("rejects unsupported language settings and sets Arabic direction", () => {
    expect(isLanguage("ar")).toBe(true);
    expect(isLanguage("unsupported")).toBe(false);
    expect(isLanguage(null)).toBe(false);
    expect(languageDirection("ar")).toBe("rtl");
    expect(languageDirection("ko")).toBe("ltr");
  });
});
