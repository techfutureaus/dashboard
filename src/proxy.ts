import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = "session";
const PUBLIC_ROUTES = ["/login", "/api/auth"];
const PASSWORD = process.env.DASHBOARD_PASSWORD;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public routes never require auth.
  if (PUBLIC_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"))) {
    return NextResponse.next();
  }

  // If no password is configured, allow in dev mode (no auth needed) but
  // refuse in production so a deploy without env vars doesn't accidentally
  // expose the dashboard.
  if (!PASSWORD) {
    if (process.env.NODE_ENV === "development") {
      return NextResponse.next();
    }
    return new NextResponse(
      "DASHBOARD_PASSWORD is not configured on this deployment. Set it in environment variables.",
      { status: 503 }
    );
  }

  const session = request.cookies.get(SESSION_COOKIE)?.value || "";
  if (!timingSafeEqual(session, PASSWORD)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const target = pathname + (request.nextUrl.search || "");
    const loginUrl = new URL("/login", request.url);
    if (target && target !== "/" && target !== "/login") {
      loginUrl.searchParams.set("redirect", target);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*$).*)"],
};
