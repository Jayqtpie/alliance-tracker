import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { triggerBridgeExtraction } from "./github-dispatch";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GitHub Actions bridge trigger", () => {
  it("does nothing when the repository or token is not configured", async () => {
    vi.stubEnv("GITHUB_DISPATCH_TOKEN", "");
    vi.stubEnv("GITHUB_REPO", "owner/repo");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await triggerBridgeExtraction()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a repository dispatch for the bridge workflow", async () => {
    vi.stubEnv("GITHUB_DISPATCH_TOKEN", "token-123");
    vi.stubEnv("GITHUB_REPO", "owner/repo");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await triggerBridgeExtraction()).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/owner/repo/dispatches");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer token-123");
    expect(JSON.parse(init.body)).toEqual({ event_type: "bridge-job" });
  });

  it("reports failure without throwing when GitHub rejects or is unreachable", async () => {
    vi.stubEnv("GITHUB_DISPATCH_TOKEN", "token-123");
    vi.stubEnv("GITHUB_REPO", "owner/repo");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));
    expect(await triggerBridgeExtraction()).toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await triggerBridgeExtraction()).toBe(false);
  });
});
