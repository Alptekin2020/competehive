import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { hashPassword, verifyPassword, createToken, setAuthCookie } from "@/lib/auth";
import { z } from "zod";

// ============================================
// POST /api/auth - Login & Register
// ============================================

const registerSchema = z.object({
  action: z.literal("register"),
  email: z.string().email("Geçerli bir e-posta adresi girin"),
  password: z.string().min(8, "Şifre en az 8 karakter olmalı"),
  name: z.string().min(2, "İsim en az 2 karakter olmalı"),
});

const loginSchema = z.object({
  action: z.literal("login"),
  email: z.string().email(),
  password: z.string(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // ---- REGISTER ----
    if (body.action === "register") {
      const parsed = registerSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.errors[0].message },
          { status: 400 }
        );
      }

      const { email, password, name } = parsed.data;

      // Kullanıcı zaten var mı?
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return NextResponse.json(
          { error: "Bu e-posta adresi zaten kayıtlı" },
          { status: 409 }
        );
      }

      // Kullanıcı oluştur
      const passwordHash = await hashPassword(password);
      const user = await prisma.user.create({
        data: { email, passwordHash, name, plan: "FREE", maxProducts: 5 },
      });

      // Token oluştur ve cookie'ye yaz
      const token = await createToken({
        userId: user.id,
        email: user.email,
        plan: user.plan,
      });
      await setAuthCookie(token);

      return NextResponse.json({
        success: true,
        user: { id: user.id, email: user.email, name: user.name, plan: user.plan },
      });
    }

    // ---- LOGIN ----
    if (body.action === "login") {
      const parsed = loginSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Geçersiz giriş bilgileri" },
          { status: 400 }
        );
      }

      const { email, password } = parsed.data;

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        return NextResponse.json(
          { error: "E-posta veya şifre hatalı" },
          { status: 401 }
        );
      }

      const isValid = await verifyPassword(password, user.passwordHash);
      if (!isValid) {
        return NextResponse.json(
          { error: "E-posta veya şifre hatalı" },
          { status: 401 }
        );
      }

      const token = await createToken({
        userId: user.id,
        email: user.email,
        plan: user.plan,
      });
      await setAuthCookie(token);

      return NextResponse.json({
        success: true,
        user: { id: user.id, email: user.email, name: user.name, plan: user.plan },
      });
    }

    return NextResponse.json({ error: "Geçersiz istek" }, { status: 400 });
  } catch (error) {
    console.error("Auth error:", error);
    return NextResponse.json({ error: "Sunucu hatası" }, { status: 500 });
  }
}
