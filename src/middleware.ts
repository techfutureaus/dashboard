import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// AUTH DISABLED FOR LOCAL DEV — see commented block below to re-enable.
export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

// const SESSION_COOKIE = "session";
// const publicRoutes = ["/login", "/api/auth"];
//
// export function middleware(request: NextRequest) {
//   const { pathname } = request.nextUrl;
//   const isPublicRoute = publicRoutes.some(
//     (route) => pathname === route || pathname.startsWith(route + "/")
//   );
//   if (isPublicRoute) return NextResponse.next();
//   const session = request.cookies.get(SESSION_COOKIE);
//   if (!session?.value) {
//     if (pathname.startsWith("/api/")) {
//       return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
//     }
//     const target = pathname + (request.nextUrl.search || "");
//     const loginUrl = new URL("/login", request.url);
//     if (target && target !== "/" && target !== "/login") {
//       loginUrl.searchParams.set("redirect", target);
//     }
//     return NextResponse.redirect(loginUrl);
//   }
//   return NextResponse.next();
// }

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*$).*)"],
};
