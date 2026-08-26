import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Alliance Manager | RSCL",
  description: "RSCL weekly Alliance Duel performance tracker",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
