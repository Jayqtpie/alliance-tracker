import type { Metadata } from "next";
import "./globals.css";
import "./themes.css";

export const metadata: Metadata = {
  title: "Alliance Manager | RSCL",
  description: "RSCL weekly Alliance Duel performance tracker",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: `(function(){var t;try{t=localStorage.getItem('rscl-theme')}catch(e){}document.documentElement.dataset.theme=t==='light'||t==='dark'?t:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'})()` }} /></head>
      <body>{children}</body>
    </html>
  );
}
