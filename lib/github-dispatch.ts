import "server-only";

// Starts the GitHub Actions bridge worker. A missed trigger leaves the job pending
// for the next run or a PC worker, so failures are reported, never thrown.
export async function triggerBridgeExtraction() {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) return false;
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
    return response.ok;
  } catch {
    return false;
  }
}
