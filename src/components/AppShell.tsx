import { NavLink } from "react-router-dom";
import { MessageSquare, Users, User, Settings as SettingsIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/", label: "Sohbetler", icon: MessageSquare, end: true },
  { to: "/contacts", label: "Kişiler", icon: Users },
  { to: "/profile", label: "Profil", icon: User },
  { to: "/settings", label: "Ayarlar", icon: SettingsIcon },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <main className="flex-1 overflow-hidden">{children}</main>
      <nav className="grid grid-cols-4 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.end}
            className={({ isActive }) =>
              cn(
                "flex flex-col items-center justify-center gap-1 py-3 text-xs transition-colors",
                isActive ? "text-primary" : "text-muted-foreground",
              )
            }
          >
            <it.icon className="h-5 w-5" />
            <span className="font-medium">{it.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
