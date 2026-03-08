import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      error: "Database migrations are disabled over HTTP. Use Prisma CLI (generate + migrate) in CI/CD or local development.",
    },
    { status: 410 }
  );
}
