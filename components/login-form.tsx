"use client";

import type { TrackerState } from "@/lib/types";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { AllianceMark } from "@/components/alliance-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSelector, useLanguage } from "@/components/language-selector";

export function LoginForm({ alliance }: { alliance?: TrackerState["alliance"] }) {
  const router = useRouter();
  const { t } = useLanguage();
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      if (response.ok) router.push("/");
      else setError(response.status === 429 ? t("Too many sign-in attempts. Please wait five minutes.") :
        response.status === 503 ? t("Sign-in is unavailable. Contact your administrator.") : t("That passcode was not recognised."));
    } catch {
      setError(t("Could not connect. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <div className="login-theme-toggle"><LanguageSelector /><ThemeToggle /></div>
      <section className="login-panel">
        <AllianceMark alliance={alliance} />
        <p className="eyebrow">{alliance?.name ? `${alliance.tag} · ${t("SERVER")} ${alliance.server}` : t("ALLIANCE ACCESS")}</p>
        <h1>{t("Alliance Manager")}</h1>
        <p className="muted">{t("A clear view of who is moving the alliance forward.")}</p>
        <form onSubmit={submit} className="login-form">
          <label htmlFor="passcode">{t("Passcode")}</label>
          <input
            id="passcode"
            type="password"
            autoComplete="current-password"
            maxLength={256}
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
            placeholder={t("Enter shared passcode")}
            autoFocus
          />
          {error && <p className="form-error">{error}</p>}
          <button className="button primary wide" disabled={busy || !passcode}>
            {t(busy ? "Checking…" : "Open alliance manager")} <ArrowRight size={17} />
          </button>
        </form>
        <div className="login-note"><ShieldCheck size={15} /> {t("Admin and viewer access")}</div>
      </section>
    </main>
  );
}
