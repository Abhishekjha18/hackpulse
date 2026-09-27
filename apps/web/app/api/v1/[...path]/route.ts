import { NextRequest, NextResponse } from "next/server";

/**
 * ADR-002: web is a client of @hackpulse/api, never the database directly.
 * Proxies every /api/v1/* call, reading HACKPULSE_API_URL fresh per request
 * rather than via next.config.js's `rewrites()`, which resolves its
 * destinations once at build time and can't see a runtime-only value like
 * Docker Compose's `api` service hostname.
 */
async function proxy(request: NextRequest, { params }: { params: { path: string[] } }) {
  const apiUrl = process.env.HACKPULSE_API_URL ?? "http://localhost:3001";
  const targetUrl = `${apiUrl}/api/v1/${params.path.join("/")}${request.nextUrl.search}`;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("connection");
  headers.delete("content-length");

  const hasBody = !["GET", "HEAD"].includes(request.method);

  const response = await fetch(targetUrl, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: "manual",
  });

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("transfer-encoding");

  return new NextResponse(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

export {
  proxy as DELETE,
  proxy as GET,
  proxy as OPTIONS,
  proxy as PATCH,
  proxy as POST,
  proxy as PUT,
};
