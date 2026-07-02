import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

/**
 * Registers the device with FCM (via Capacitor) and stores the token
 * in device_tokens for the current user. Also handles tap-to-open behavior:
 * when a push notification is tapped, navigate to the target conversation.
 *
 * No-op on web (browser). Only runs on native Android/iOS.
 */
export function usePushNotifications() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    if (!Capacitor.isNativePlatform()) return;

    let cleanup: (() => void) | undefined;

    (async () => {
      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");

        let perm = await PushNotifications.checkPermissions();
        if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
          perm = await PushNotifications.requestPermissions();
        }
        if (perm.receive !== "granted") {
          console.warn("[push] permission not granted");
          return;
        }

        await PushNotifications.register();

        const regHandle = await PushNotifications.addListener("registration", async (t) => {
          try {
            await supabase.from("device_tokens").upsert(
              { user_id: user.id, token: t.value, platform: Capacitor.getPlatform() },
              { onConflict: "token" },
            );
          } catch (e) {
            console.error("[push] token save failed", e);
          }
        });

        const errHandle = await PushNotifications.addListener("registrationError", (err) => {
          console.error("[push] registration error", err);
        });

        const tapHandle = await PushNotifications.addListener(
          "pushNotificationActionPerformed",
          (action) => {
            const data = action.notification.data as Record<string, string> | undefined;
            const convId = data?.conversation_id;
            if (convId) navigate(`/chat/${convId}`);
          },
        );

        cleanup = () => {
          regHandle.remove();
          errHandle.remove();
          tapHandle.remove();
        };
      } catch (e) {
        console.error("[push] init error", e);
      }
    })();

    return () => cleanup?.();
  }, [user, navigate]);
}
