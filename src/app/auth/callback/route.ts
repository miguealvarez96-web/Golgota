import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next");

  if (!code) {
    return NextResponse.redirect(
      new URL("/login?error=callback", requestUrl.origin)
    );
  }

  const supabase = createClient();

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL("/login?error=callback", requestUrl.origin)
    );
  }

  const destination = next === "/portal" ? "/portal" : "/reset-password";
  return NextResponse.redirect(new URL(destination, requestUrl.origin));
}
