import type { Language, Translator } from "./i18n";

export function accurateAsOf(isoDate: string, t?: Translator, language: Language = "en") {
  const date = new Date(`${isoDate}T00:00:00Z`);
  const day = date.getUTCDate();
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th");
  const month = new Intl.DateTimeFormat(language === "en" ? "en-GB" : language, { month: "short", timeZone: "UTC" }).format(date);
  // Only English takes the ordinal suffix; other locales read the plain day number.
  const value = language === "en"
    ? `${day}${suffix} ${month} ${date.getUTCFullYear()}`
    : `${day} ${month} ${date.getUTCFullYear()}`;
  return t ? t("Accurate as of {date}", { date: value }) : `Accurate as of ${value}`;
}
