import { NextResponse } from "next/server";
import { clearCache } from "@/api/_lib/config";

// POST /api/refresh — admin calls this after switching env
// Forces proxy to re-read Supabase config on next request (no 30s wait)
export async function POST() {
  clearCache();
  return NextResponse.json({ ok: true, message: "Cache cleared, next request will use latest Supabase config." });
}

// GET /api/refresh — health check
export async function GET() {
  return NextResponse.json({ ok: true, message: "Send POST to clear config cache." });
}
