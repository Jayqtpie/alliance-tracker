// Browser callers must use this origin. Non-browser bearer/cron clients have no Origin.
export function allowedRequestOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) {
    const target = new URL(request.url);
    // Next may normalize request.url to its internal hostname; Host is the browser target.
    const host = request.headers.get("host") || target.host;
    const protocol = process.env.VERCEL === "1" ? (request.headers.get("x-forwarded-proto") || target.protocol.slice(0, -1)) + ":" : target.protocol;
    if (origin !== `${protocol}//${host}`) return false;
  }
  const site = request.headers.get("sec-fetch-site");
  return !site || site === "same-origin" || site === "none";
}
