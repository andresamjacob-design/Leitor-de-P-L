import { NextResponse, type NextRequest } from "next/server";
import { publicOrigin } from "@/lib/public-origin";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", publicOrigin(request)), {
    status: 303,
  });
}
