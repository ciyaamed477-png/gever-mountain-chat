// Sends FCM push notifications to conversation members when a new message is created.
// Called by a Postgres trigger (pg_net) with { message_id }.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FCM_JSON = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON")!;

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

let cachedToken: { token: string; exp: number } | null = null;

function pemToBinary(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function b64urlEncode(data: string | Uint8Array): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.token;

  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64urlEncode(JSON.stringify(header))}.${b64urlEncode(JSON.stringify(claim))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBinary(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)),
  );
  const jwt = `${unsigned}.${b64urlEncode(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Google OAuth: ${JSON.stringify(j)}`);
  cachedToken = { token: j.access_token, exp: now + (j.expires_in ?? 3600) };
  return cachedToken.token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { message_id } = await req.json();
    if (!message_id) return new Response("bad", { status: 400, headers: corsHeaders });

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: msg, error: mErr } = await sb
      .from("messages")
      .select("id, conversation_id, sender_id, content, message_type")
      .eq("id", message_id)
      .maybeSingle();
    if (mErr || !msg) throw new Error(`msg lookup: ${mErr?.message}`);

    const { data: conv } = await sb
      .from("conversations")
      .select("is_group, group_name")
      .eq("id", msg.conversation_id)
      .maybeSingle();

    const { data: sender } = await sb
      .from("profiles")
      .select("display_name")
      .eq("id", msg.sender_id)
      .maybeSingle();

    const { data: members } = await sb
      .from("conversation_members")
      .select("user_id")
      .eq("conversation_id", msg.conversation_id)
      .neq("user_id", msg.sender_id);

    const recipientIds = (members ?? []).map((m: any) => m.user_id);
    if (recipientIds.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: tokens } = await sb
      .from("device_tokens")
      .select("token")
      .in("user_id", recipientIds);

    const targets: string[] = (tokens ?? []).map((t: any) => t.token);
    if (targets.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sa: ServiceAccount = JSON.parse(FCM_JSON);
    const accessToken = await getAccessToken(sa);

    const title = conv?.is_group
      ? `${conv.group_name ?? "Grup"} · ${sender?.display_name ?? "Yeni mesaj"}`
      : sender?.display_name ?? "Yeni mesaj";
    let body = msg.content ?? "";
    if (msg.message_type === "image") body = "📷 Fotoğraf";
    else if (msg.message_type === "file") body = "📎 Dosya";
    else if (msg.message_type === "voice") body = "🎤 Sesli mesaj";
    if (body.length > 120) body = body.slice(0, 117) + "...";

    const endpoint = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
    let sent = 0;
    const invalidTokens: string[] = [];

    await Promise.all(
      targets.map(async (token) => {
        const payload = {
          message: {
            token,
            notification: { title, body },
            data: {
              conversation_id: String(msg.conversation_id),
              message_id: String(msg.id),
              type: "chat_message",
            },
            android: {
              priority: "HIGH",
              notification: { channel_id: "gever_messages", sound: "default" },
            },
          },
        };
        const r = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
        if (r.ok) sent++;
        else {
          const errBody = await r.text();
          if (r.status === 404 || errBody.includes("UNREGISTERED") || errBody.includes("INVALID_ARGUMENT")) {
            invalidTokens.push(token);
          }
          console.error("fcm err", r.status, errBody);
        }
      }),
    );

    if (invalidTokens.length) {
      await sb.from("device_tokens").delete().in("token", invalidTokens);
    }

    return new Response(JSON.stringify({ sent, invalid: invalidTokens.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-push error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
