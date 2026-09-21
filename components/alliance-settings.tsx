"use client";

import { useState } from "react";
import { ArrowRight, Check, Lock, LockOpen, ShieldCheck } from "lucide-react";
import { AllianceMark } from "./alliance-mark";
import { allianceNeedsSetup, allianceSchema } from "@/lib/alliance";
import type { TrackerState } from "@/lib/types";
import { useLanguage } from "./language-selector";

export function AllianceSettings({ state, onSaved }: { state: TrackerState; onSaved: (state: TrackerState) => void }) {
  const { t } = useLanguage();
  const setup = allianceNeedsSetup(state.alliance);
  const [alliance, setAlliance] = useState(state.alliance);
  // Existing settings open locked so they cannot be changed by accident; saving re-mounts (new key) and re-locks.
  const [locked, setLocked] = useState(!setup);
  const [busy, setBusy] = useState(false);
  const [processingEmblem, setProcessingEmblem] = useState(false);
  const [error, setError] = useState("");

  async function chooseEmblem(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError(t("Choose a PNG, JPG or WebP image under 5 MB."));
      return;
    }
    setProcessingEmblem(true);
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 192 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error(t("Image preview is unavailable. Please try another browser."));
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const emblem = canvas.toDataURL("image/png");
      const parsed = allianceSchema.shape.emblem.safeParse(emblem);
      if (!parsed.success) throw new Error(t("This image could not be used. Please choose another emblem."));
      setAlliance((current) => ({ ...current, emblem }));
    } catch (error) {
      setError(error instanceof Error ? error.message : t("Could not read this image. Please choose another emblem."));
    } finally {
      bitmap?.close();
      setProcessingEmblem(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const parsed = allianceSchema.safeParse(alliance);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/alliance", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ alliance: parsed.data, version: state.version }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || t("Could not save alliance settings."));
      onSaved(body);
    } catch (error) {
      setError(error instanceof Error ? error.message : t("Could not connect. Please try again."));
    } finally { setBusy(false); }
  }

  return (
    <div className="page-stack alliance-settings-page">
      <section className="dashboard-heading"><div>
        <p className="eyebrow">{t(setup ? "WELCOME TO ALLIANCE MANAGER" : "MAKE IT YOUR ALLIANCE")}</p>
        <h1>{t(setup ? "Your alliance starts here." : "Alliance settings.")}</h1>
        <p>{t(setup ? "Set up your private leadership workspace in a few moments." : "Keep your alliance identity up to date across your workspace and reports.")}</p>
      </div></section>
      <section className="panel alliance-settings-panel">
        <div className="alliance-identity-preview">
          <AllianceMark alliance={alliance} />
          <div><strong>{alliance.name || t("Your alliance")}</strong><p>{alliance.tag || t("TAG")} · {t("Server")} {alliance.server || "—"}</p></div>
          {!setup && <button type="button" className="button ghost alliance-lock-toggle" aria-pressed={locked} onClick={() => { setLocked(!locked); setAlliance(state.alliance); setError(""); }} disabled={busy || processingEmblem}>{locked ? <><Lock size={16} /> {t("Unlock to edit")}</> : <><LockOpen size={16} /> {t("Lock")}</>}</button>}
        </div>
        <form onSubmit={save} className="alliance-settings-form">
          <fieldset disabled={locked || busy || processingEmblem}>
            <div className="alliance-emblem-controls">
              <label htmlFor="alliance-emblem">{t("Alliance emblem")}<input id="alliance-emblem" type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseEmblem} /><small>{t(processingEmblem ? "Preparing emblem…" : "Keep the default badge or choose your own. PNG, JPG or WebP, up to 5 MB.")}</small></label>
              {alliance.emblem && <button type="button" className="button ghost" onClick={() => setAlliance((current) => ({ ...current, emblem: null }))}>{t("Use default emblem")}</button>}
            </div>
            <label htmlFor="alliance-name">{t("Alliance name")}<input id="alliance-name" value={alliance.name} onChange={(event) => setAlliance({ ...alliance, name: event.target.value })} placeholder={t("e.g. {example}", { example: "The Phoenix Guard" })} maxLength={80} required /></label>
            <div className="alliance-settings-fields">
              <label htmlFor="alliance-tag">{t("Alliance tag")}<input id="alliance-tag" value={alliance.tag} onChange={(event) => setAlliance({ ...alliance, tag: event.target.value })} placeholder={t("e.g. {example}", { example: "PHNX" })} maxLength={8} required /><small>{t("The short tag shown beside your alliance name in game.")}</small></label>
              <label htmlFor="alliance-server">{t("Server number")}<input id="alliance-server" inputMode="numeric" pattern="[1-9][0-9]{0,5}" value={alliance.server} onChange={(event) => setAlliance({ ...alliance, server: event.target.value })} placeholder={t("e.g. {example}", { example: "1234" })} maxLength={6} required /></label>
            </div>
          </fieldset>
          {error && <p className="form-error-box" role="alert">{error}</p>}
          <div className="alliance-settings-footer"><p><ShieldCheck size={17} /> {t(setup ? "A fresh roster, ready for your commanders." : "Your roster and score history stay connected.")}</p><button className="button primary" disabled={locked || busy || processingEmblem}>{t(busy ? "Saving…" : setup ? "Create alliance workspace" : "Save changes")}{setup ? <ArrowRight size={16} /> : <Check size={16} />}</button></div>
        </form>
      </section>
    </div>
  );
}
