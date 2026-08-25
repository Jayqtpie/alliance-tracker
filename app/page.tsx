import { redirect } from "next/navigation";
import { TrackerApp } from "@/components/tracker-app";
import { isAuthenticated } from "@/lib/auth";
import { getState, storageMode } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!(await isAuthenticated())) redirect("/login");
  const state = await getState();
  return (
    <TrackerApp
      initialState={state}
      storageMode={storageMode()}
      ocrConfigured={Boolean(process.env.OPENAI_API_KEY)}
    />
  );
}
