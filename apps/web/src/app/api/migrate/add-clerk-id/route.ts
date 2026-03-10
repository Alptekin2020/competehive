import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      error:
        "Database migrations are disabled over HTTP. Deployments must run the repository migration scripts (Prisma migrate deploy) before the web app starts.",
    },
    { status: 410 }
  );
}
