import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export async function GET() {
  const prisma = new PrismaClient();
  try {
    const newValues = ['CICEKSEPETI', 'PTTAVM', 'AKAKCE', 'CIMRI', 'EPEY'];
    for (const val of newValues) {
      await prisma.$executeRawUnsafe(
        `DO $$ BEGIN ALTER TYPE "Marketplace" ADD VALUE IF NOT EXISTS '${val}'; EXCEPTION WHEN duplicate_object THEN null; END $$`
      );
    }
    const result = await prisma.$queryRaw`SELECT enum_range(NULL::"Marketplace")`;
    await prisma.$disconnect();
    return NextResponse.json({ success: true, marketplaces: result });
  } catch (error: any) {
    await prisma.$disconnect();
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
