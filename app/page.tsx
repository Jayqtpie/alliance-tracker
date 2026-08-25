import { redirect } from "next/navigation";
import { TrackerApp } from "@/components/tracker-app";
import { isAuthenticated } from "@/lib/auth";
import { getState, storageMode } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!(await isAuthenticated())) redirect("/login");
  let state;
  try {
    state = await getState();
  } catch (error) {
    const detail = error instanceof Error ? error.message : "An unknown storage error occurred.";
    return (
      <main className="login-shell">
        <section className="login-panel storage-error-panel">
          <div className="brand-mark">!</div>
          <p className="eyebrow">STORAGE DIAGNOSTIC</p>
          <h1>Shared storage could not load</h1>
          <p className="muted">
            Your officer login succeeded, but the tracker could not open its private Vercel Blob store.
          </p>
          <pre className="storage-error-detail">{detail}</pre>
          <p className="login-note">
            Check that the Blob store is connected to this exact Vercel project and that the token applies to Production,
            then redeploy.
          </p>
        </section>
      </main>
    );
  }
  return (
    <TrackerApp
      initialState={state}
      storageMode={storageMode()}
      ocrConfigured={Boolean(process.env.OPENAI_API_KEY)}
    />
  );
}
