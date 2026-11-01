import type { Language, Translator } from "./i18n";

/** The Intl locale used for each app language. English follows British day-month order. */
export function intlLocale(language: Language) {
  return language === "en" ? "en-GB" : language;
}

type WeekdayStyle = "long" | "short";
type DateField = "weekday" | "day" | "month" | "year";

// Explicit layouts for "weekday + day + month + year". Engines ship different ICU
// versions, and their default patterns disagree on separators (WebKit renders
// "Tuesday 25 Aug 2026" where Node renders "Tuesday, 25 Aug 2026"). That breaks
// hydration, so only the field values come from Intl and the punctuation lives here.
const WEEKDAY_DATE_LAYOUTS: Record<Language, Record<WeekdayStyle, string>> = {
  en: { long: "{weekday}, {day} {month} {year}", short: "{weekday}, {day} {month} {year}" },
  es: { long: "{weekday}, {day} de {month} de {year}", short: "{weekday}, {day} {month} {year}" },
  fr: { long: "{weekday} {day} {month} {year}", short: "{weekday} {day} {month} {year}" },
  de: { long: "{weekday}, {day}. {month} {year}", short: "{weekday}, {day}. {month} {year}" },
  it: { long: "{weekday} {day} {month} {year}", short: "{weekday} {day} {month} {year}" },
  ar: { long: "{weekday}، {day} {month} {year}", short: "{weekday}، {day} {month} {year}" },
  th: { long: "{weekday}ที่ {day} {month} {year}", short: "{weekday} {day} {month} {year}" },
  zh: { long: "{year}年{month}月{day}日{weekday}", short: "{year}年{month}月{day}日{weekday}" },
  ko: { long: "{year}년 {month}월 {day}일 {weekday}", short: "{year}년 {month}월 {day}일 ({weekday})" },
  tr: { long: "{day} {month} {year} {weekday}", short: "{day} {month} {year} {weekday}" },
};

// Chinese and Korean write the month as a number followed by a unit the layout supplies.
const NUMERIC_MONTH_LANGUAGES: ReadonlySet<Language> = new Set(["zh", "ko"]);

// Chromium ships its own Thai data and abbreviates weekdays as "อังคาร" where Node and
// WebKit use "อ.", so those names are pinned too (indexed by getUTCDay, Sunday first).
const PINNED_SHORT_WEEKDAYS: Partial<Record<Language, readonly string[]>> = {
  th: ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."],
};

/**
 * Formats a weekday date ("Tuesday, 25 Aug 2026") identically on the server and in every browser.
 * `isoDate` is a calendar date (YYYY-MM-DD) or a full ISO timestamp, read in UTC.
 */
export function weekdayDate(isoDate: string, language: Language = "en", weekday: WeekdayStyle = "long") {
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? `${isoDate}T12:00:00Z` : isoDate);
  const parts = new Intl.DateTimeFormat(`${intlLocale(language)}-u-nu-latn`, {
    weekday,
    day: "numeric",
    month: NUMERIC_MONTH_LANGUAGES.has(language) ? "numeric" : "short",
    year: "numeric",
    timeZone: "UTC",
  }).formatToParts(date);
  const pinnedWeekday = weekday === "short" ? PINNED_SHORT_WEEKDAYS[language]?.[date.getUTCDay()] : undefined;
  const field = (type: DateField) => (type === "weekday" && pinnedWeekday) || (parts.find((part) => part.type === type)?.value ?? "");
  return WEEKDAY_DATE_LAYOUTS[language][weekday].replace(/\{(weekday|day|month|year)\}/g, (_, type: DateField) => field(type));
}

export function accurateAsOf(isoDate: string, t?: Translator, language: Language = "en") {
  const date = new Date(`${isoDate}T00:00:00Z`);
  const day = date.getUTCDate();
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th");
  const month = new Intl.DateTimeFormat(intlLocale(language), { month: "short", timeZone: "UTC" }).format(date);
  // Only English takes the ordinal suffix; other locales read the plain day number.
  const value = language === "en"
    ? `${day}${suffix} ${month} ${date.getUTCFullYear()}`
    : `${day} ${month} ${date.getUTCFullYear()}`;
  return t ? t("Accurate as of {date}", { date: value }) : `Accurate as of ${value}`;
}
