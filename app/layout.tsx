import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rascals Command | Alliance Tracker",
  description: "RSCL weekly Alliance Duel performance tracker",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
