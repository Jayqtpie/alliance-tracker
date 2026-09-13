import { headers } from "next/headers";
import type { Metadata } from "next";
import { themeInitializationScript } from "@/lib/theme";
import "./globals.css";
import "./themes.css";
import "./refinements.css";

export const metadata: Metadata = {
  title: "Alliance Manager",
  description: "A private Alliance Duel performance tracker for alliance leadership",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitializationScript }} /></head>
      <body>{children}</body>
    </html>
  );
}
