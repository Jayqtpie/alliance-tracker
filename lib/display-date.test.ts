import { afterEach, describe, expect, it, vi } from "vitest";
import { accurateAsOf, weekdayDate } from "./display-date";
import { LANGUAGE_OPTIONS } from "./i18n";

describe("weekdayDate", () => {
  afterEach(() => vi.restoreAllMocks());

  it("pins the long weekday format for every app language", () => {
    const rendered = Object.fromEntries(LANGUAGE_OPTIONS.map(({ code }) => [code, weekdayDate("2026-08-25T09:30:00Z", code)]));
    expect(rendered).toEqual({
      en: "Tuesday, 25 Aug 2026",
      es: "martes, 25 de ago de 2026",
      fr: "mardi 25 août 2026",
      de: "Dienstag, 25. Aug. 2026",
      it: "martedì 25 ago 2026",
      ar: "الثلاثاء، 25 أغسطس 2026",
      th: "วันอังคารที่ 25 ส.ค. 2569",
      zh: "2026年8月25日星期二",
      ko: "2026년 8월 25일 화요일",
      tr: "25 Ağu 2026 Salı",
    });
  });

  it("pins the short weekday format and reads calendar dates as that day", () => {
    expect(weekdayDate("2026-08-25", "en", "short")).toBe("Tue, 25 Aug 2026");
    expect(weekdayDate("2026-08-25", "de", "short")).toBe("Di., 25. Aug. 2026");
    expect(weekdayDate("2026-08-25", "ko", "short")).toBe("2026년 8월 25일 (화)");
    // Chromium abbreviates Thai weekdays differently from Node, so the abbreviation is pinned.
    expect(["2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29"].map((date) => weekdayDate(date, "th", "short").split(" ")[0]))
      .toEqual(["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."]);
    // Late-evening UTC captures stay on their UTC day whatever the server or browser time zone is.
    expect(weekdayDate("2026-08-25T23:59:00Z", "en")).toBe("Tuesday, 25 Aug 2026");
  });

  it("ignores the engine's own separators so server and browser text match", () => {
    // WebKit's ICU joins the weekday with a space instead of Node's comma.
    vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockReturnValue([
      { type: "weekday", value: "Tuesday" },
      { type: "literal", value: " " },
      { type: "day", value: "25" },
      { type: "literal", value: " " },
      { type: "month", value: "Aug" },
      { type: "literal", value: " " },
      { type: "year", value: "2026" },
    ]);
    expect(weekdayDate("2026-08-25T00:00:00Z", "en")).toBe("Tuesday, 25 Aug 2026");
  });
});

describe("accurateAsOf", () => {
  it("adds the English ordinal and keeps plain days elsewhere", () => {
    expect(accurateAsOf("2026-08-23")).toBe("Accurate as of 23rd Aug 2026");
    expect(accurateAsOf("2026-08-11")).toBe("Accurate as of 11th Aug 2026");
    expect(accurateAsOf("2026-08-25", (key, values) => key.replace("{date}", String(values?.date)), "fr")).toBe("Accurate as of 25 août 2026");
  });
});
