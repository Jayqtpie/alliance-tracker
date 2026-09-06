import type { Metadata } from "next";
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
      <head><script dangerouslySetInnerHTML={{ __html: `(function(){var t;try{t=localStorage.getItem('rscl-theme')}catch(e){}document.documentElement.dataset.theme=t==='light'||t==='dark'?t:'dark'})()` }} /></head>
      <body>{children}</body>
    </html>
  );
}
