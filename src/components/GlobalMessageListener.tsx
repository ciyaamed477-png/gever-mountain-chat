import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

// Web Audio API — short pleasant "ding" without external assets.
function playDing() {
  try {
    const Ctx = (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.45);
  } catch {
    /* ignore */
  }
}

/**
 * Foreground-only realtime listener.
 * Shows a toast + plays a sound when a new message arrives in a conversation
 * the user is a member of, unless the user is already inside that chat.
 */
export function GlobalMessageListener() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const locationRef = useRef(location.pathname);
  locationRef.current = location.pathname;

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel("global-messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        async (payload) => {
          const msg = payload.new as {
            id: string;
            conversation_id: string;
            sender_id: string;
            content: string;
          };
          if (msg.sender_id === user.id) return;

          // Check membership
          const { data: member } = await supabase
            .from("conversation_members")
            .select("conversation_id, notifications_enabled")
            .eq("conversation_id", msg.conversation_id)
            .eq("user_id", user.id)
            .maybeSingle();
          if (!member) return;
          if (member.notifications_enabled === false) return;

          // Skip if already viewing this chat
          if (locationRef.current === `/chat/${msg.conversation_id}`) return;

          // Get sender name
          const { data: sender } = await supabase
            .from("profiles")
            .select("display_name, gever_number")
            .eq("id", msg.sender_id)
            .maybeSingle();

          const name = sender?.display_name || `#${sender?.gever_number || ""}`;
          playDing();
          toast(name, {
            description: msg.content.slice(0, 120),
            action: {
              label: "Aç",
              onClick: () => navigate(`/chat/${msg.conversation_id}`),
            },
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, navigate]);

  return null;
}
