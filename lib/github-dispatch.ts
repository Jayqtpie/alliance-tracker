import "server-only";

export type BridgeDispatch = { started: boolean; error?: string };

// Starts the GitHub Actions bridge worker. A missed trigger leaves the job pending
// for the next run or a PC worker, so failures are reported, never thrown. Without a
// token or repository the bridge relies on a PC worker, which is not an error.
export async function triggerBridgeExtraction(): Promise<BridgeDispatch> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) return { started: false };
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify({ event_type: "bridge-job" }),
    });
    if (response.ok) return { started: true };
    // A fine-grained token that expires stops every extraction this way (2026-10-18).
    const hint = response.status === 401 ? " The dispatch token may have expired or been revoked."
      : response.status === 403 || response.status === 404 ? " Check the dispatch token's access to this repository." : "";
    return { started: false, error: `GitHub rejected the extraction trigger (HTTP ${response.status}).${hint}` };
  } catch {
    return { started: false, error: "Could not reach GitHub to start the extraction." };
  }
}
