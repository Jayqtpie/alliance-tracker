"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ShieldCheck } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode }),
    });
    if (response.ok) router.push("/");
    else {
      setError("That passcode was not recognised.");
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="brand-mark">R</div>
        <p className="eyebrow">RSCL · SERVER 927</p>
        <h1>Rascals Command</h1>
        <p className="muted">A clear view of who is moving the alliance forward.</p>
        <form onSubmit={submit} className="login-form">
          <label htmlFor="passcode">Officer passcode</label>
          <input
            id="passcode"
            type="password"
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
            placeholder="Enter shared passcode"
            autoFocus
          />
          {error && <p className="form-error">{error}</p>}
          <button className="button primary wide" disabled={busy || !passcode}>
            {busy ? "Checking…" : "Enter command centre"} <ArrowRight size={17} />
          </button>
        </form>
        <div className="login-note"><ShieldCheck size={15} /> Lightweight officer access</div>
      </section>
    </main>
  );
}
