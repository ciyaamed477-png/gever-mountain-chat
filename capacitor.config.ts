import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.lovable.46b4844a8e714866905836824f1a8cc0",
  appName: "gever-mountain-chat",
  webDir: "dist",
  server: {
    url: "https://46b4844a-8e71-4866-9058-36824f1a8cc0.lovableproject.com?forceHideBadge=true",
    cleartext: true,
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
