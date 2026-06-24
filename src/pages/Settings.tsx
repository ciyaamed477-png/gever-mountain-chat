import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import logo from "@/assets/gever-logo.png";

type Settings = {
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  enterToSend: boolean;
  autoDownload: boolean;
  fontSize: "sm" | "base" | "lg";
};

const DEFAULTS: Settings = {
  notificationsEnabled: true,
  soundEnabled: true,
  enterToSend: true,
  autoDownload: true,
  fontSize: "base",
};

function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("gever:settings") || "{}") };
  } catch {
    return DEFAULTS;
  }
}
function saveSettings(s: Settings) {
  localStorage.setItem("gever:settings", JSON.stringify(s));
}

export default function SettingsPage() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [s, setS] = useState<Settings>(DEFAULTS);
  useEffect(() => setS(loadSettings()), []);
  function update<K extends keyof Settings>(k: K, v: Settings[K]) {
    const next = { ...s, [k]: v };
    setS(next);
    saveSettings(next);
  }

  const sizeIdx = s.fontSize === "sm" ? 0 : s.fontSize === "base" ? 1 : 2;

  return (
    <div className="h-full overflow-y-auto">
      <header className="px-5 pb-3 pt-6">
        <h1 className="text-2xl font-black tracking-wider">Ayarlar</h1>
      </header>

      <div className="space-y-6 px-5 pb-10">
        <Section title="Bildirimler">
          <Row
            label="Bildirimler"
            description="Uygulama açıkken yeni mesajda uyar"
            control={
              <Switch
                checked={s.notificationsEnabled}
                onCheckedChange={(v) => update("notificationsEnabled", v)}
              />
            }
          />
          <Row
            label="Ses"
            description="Yeni mesaj geldiğinde ses çal"
            control={
              <Switch
                checked={s.soundEnabled}
                onCheckedChange={(v) => update("soundEnabled", v)}
              />
            }
          />
        </Section>

        <Section title="Mesaj">
          <Row
            label="Enter ile gönder"
            description="Kapatırsan Enter satır eklemek için kullanılır"
            control={
              <Switch
                checked={s.enterToSend}
                onCheckedChange={(v) => update("enterToSend", v)}
              />
            }
          />
          <Row
            label="Otomatik indirme"
            description="Medya mesajlarını otomatik indir"
            control={
              <Switch
                checked={s.autoDownload}
                onCheckedChange={(v) => update("autoDownload", v)}
              />
            }
          />
          <div className="space-y-2 pt-2">
            <Label>Yazı boyutu</Label>
            <Slider
              value={[sizeIdx]}
              min={0}
              max={2}
              step={1}
              onValueChange={([v]) =>
                update("fontSize", v === 0 ? "sm" : v === 1 ? "base" : "lg")
              }
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Küçük</span>
              <span>Orta</span>
              <span>Büyük</span>
            </div>
          </div>
        </Section>

        <Section title="Gizlilik">
          <p className="text-sm text-muted-foreground">
            Kişiler sekmesinden istediğin kullanıcıyı engelleyebilir ya da engelini
            kaldırabilirsin. Engellediğin kişiler sana mesaj atamaz.
          </p>
        </Section>

        <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
          <img src={logo} alt="GEVER" className="h-10 w-10" />
          <div className="flex-1">
            <div className="font-semibold">GEVER</div>
            <div className="text-xs text-muted-foreground">
              Cilo Dağları'ndan ilhamla.
            </div>
          </div>
        </div>

        <Button variant="outline" className="h-12 w-full" onClick={signOut}>
          Çıkış Yap
        </Button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
        {title}
      </h2>
      <div className="space-y-4 rounded-2xl border border-border bg-card p-4">{children}</div>
    </div>
  );
}

function Row({
  label,
  description,
  control,
}: {
  label: string;
  description?: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="font-medium">{label}</div>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
      {control}
    </div>
  );
}
