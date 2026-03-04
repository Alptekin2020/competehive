import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "dev-secret-change-me");

const PUBLIC_PATHS = ["/", "/login", "/register", "/api/auth", "/api/migrate"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public yollar - auth gerekmez
  if (PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith("/api/migrate"))) {
    return NextResponse.next();
  }

  // API rotaları - auth kontrolü
  if (pathname.startsWith("/api/")) {
    // Diğer API'ler auth gerektirir ama bunu route içinde yapıyoruz
    return NextResponse.next();
  }

  // Dashboard sayfaları - auth gerektirir
  if (pathname.startsWith("/dashboard")) {
    const token = req.cookies.get("competehive_token")?.value;
    if (!token) {
      return NextResponse.redirect(new URL("/login", req.url));
    }

    try {
      await jwtVerify(token, JWT_SECRET);
      return NextResponse.next();
    } catch {
      return NextResponse.redirect(new URL("/login", req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
};
