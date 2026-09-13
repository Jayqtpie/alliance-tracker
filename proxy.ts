import { NextRequest, NextResponse } from "next/server";
import { allowedRequestOrigin } from "@/lib/request-security";

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/") && !allowedRequestOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin requests are not allowed." }, {
      status: 403, headers: { "Cache-Control": "private, no-store" },
    });
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const development = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self'",
    `connect-src 'self' https://vercel.com https://*.blob.vercel-storage.com${development ? " ws: wss:" : ""}`,
    "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = { matcher: ["/", "/login", "/api/:path*"] };
