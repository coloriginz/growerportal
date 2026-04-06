import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getCompanySlugFromHostname } from "@/lib/company-config";

/** Hostname prefixes that indicate the standalone fust domain */
const FUST_HOST_PREFIXES = ["fust.", "fust-"];

function isFustHost(hostname: string): boolean {
  return FUST_HOST_PREFIXES.some((prefix) => hostname.startsWith(prefix));
}

function setCompanyHeader(response: NextResponse, hostname: string): void {
  const slug = getCompanySlugFromHostname(hostname);
  response.headers.set("x-company-slug", slug);
}

export function middleware(request: NextRequest) {
  const hostname = request.headers.get("host")?.split(":")[0] || "";

  if (!isFustHost(hostname)) {
    const response = NextResponse.next();
    setCompanyHeader(response, hostname);
    return response;
  }

  const { pathname, search } = request.nextUrl;

  // Already an internal fust-portal path (rewritten by us, or direct) — just tag the header
  if (pathname.startsWith("/fust-portal") || pathname.startsWith("/api")) {
    const response = NextResponse.next();
    response.headers.set("x-fust-domain", "1");
    setCompanyHeader(response, hostname);
    return response;
  }

  // /login on fust domain → /fust-login
  if (pathname === "/login" || pathname === "/fust-login") {
    const url = request.nextUrl.clone();
    url.pathname = "/fust-login";
    const response = NextResponse.rewrite(url);
    response.headers.set("x-fust-domain", "1");
    setCompanyHeader(response, hostname);
    return response;
  }

  // Static assets, _next, favicon — let them through
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/icon") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  // Rewrite all other paths: / → /fust-portal, /orders → /fust-portal/orders, etc.
  const url = request.nextUrl.clone();
  if (pathname === "/") {
    url.pathname = "/fust-portal";
  } else {
    url.pathname = `/fust-portal${pathname}`;
  }
  url.search = search;

  const response = NextResponse.rewrite(url);
  response.headers.set("x-fust-domain", "1");
  setCompanyHeader(response, hostname);
  return response;
}

export const config = {
  // Run on all paths except static files
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
