import { redirect } from "next/navigation";
import { AllianceMark } from "@/components/alliance-mark";
import { TrackerApp } from "@/components/tracker-app";
import { getAccessRole } from "@/lib/auth";
import { bridgeConfigured } from "@/lib/bridge-auth";
import { getState, storageMode } from "@/lib/store";

import { stateForRole } from "@/lib/state-view";

export const dynamic = "force-dynamic";

export default async function Home() {
  const role = await getAccessRole();
  if (!role) redirect("/login");
  let state;
  try {
    state = await getState();
  } catch {
    return (
      <main className="login-shell">
        <section className="login-panel storage-error-panel">
          <AllianceMark />
          <p className="eyebrow">TEMPORARILY UNAVAILABLE</p>
          <h1>Shared storage could not load</h1>
          <p className="muted">
            Your login succeeded, but the tracker could not load its data. Please try again shortly.
          </p>
          <p className="login-note">
            Contact the alliance administrator if the problem continues.
          </p>
        </section>
      </main>
    );
  }
  return (
    <TrackerApp
      canManage={role === "admin"}
      initialState={stateForRole(state, role)}
      storageMode={storageMode()}
      ocrConfigured={Boolean(process.env.OPENAI_API_KEY)}
      bridgeConfigured={bridgeConfigured()}
    />
  );
}
