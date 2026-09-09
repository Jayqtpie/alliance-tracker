import type { Metadata } from "next";
import { themeInitializationScript } from "@/lib/theme";
import "./globals.css";
import "./themes.css";
import "./refinements.css";

export const metadata: Metadata = {
  title: "Alliance Manager",
  description: "A private Alliance Duel performance tracker for alliance leadership",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeInitializationScript }} /></head>
      <body>{children}</body>
    </html>
  );
}
