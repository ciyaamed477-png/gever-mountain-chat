import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const app = Deno.env.get("METERED_APP_NAME");
    const key = Deno.env.get("METERED_SECRET_KEY");
    if (!app || !key) {
      // Fallback: only STUN
      return new Response(
        JSON.stringify({
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const r = await fetch(
      `https://${app}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(key)}`,
    );
    if (!r.ok) {
      return new Response(
        JSON.stringify({
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const iceServers = await r.json();
    return new Response(JSON.stringify({ iceServers }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ice-servers error", e);
    return new Response(
      JSON.stringify({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
