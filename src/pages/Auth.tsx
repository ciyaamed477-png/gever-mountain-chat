import { useState } from "react";
import { friendlyError } from "@/lib/errors";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import logo from "@/assets/gever-logo.png";

const SYNTH_DOMAIN = "gever.app";

function geverEmail(num: string) {
  return `gever_${num}@${SYNTH_DOMAIN}`;
}

function genGeverNumber() {
  // 8-digit, leading digit 1-9 to avoid leading zero
  let n = String(Math.floor(10000000 + Math.random() * 90000000));
  return n.slice(0, 8);
}

export default function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);
  // signin
  const [num, setNum] = useState("");
  const [pw, setPw] = useState("");
  // signup
  const [name, setName] = useState("");
  const [pw2, setPw2] = useState("");

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{8}$/.test(num)) return toast.error("Gever numarası 8 haneli olmalı");
    if (pw.length < 6) return toast.error("Şifre en az 6 karakter olmalı");
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: geverEmail(num),
      password: pw,
    });
    setBusy(false);
    if (error) return toast.error("Giriş başarısız: numara veya şifre hatalı");
    toast.success("Hoş geldin!");
    navigate("/", { replace: true });
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error("İsim gerekli");
    if (pw2.length < 6) return toast.error("Şifre en az 6 karakter olmalı");
    setBusy(true);
    // Try up to 5 random numbers to avoid collision
    let lastError: string | null = null;
    for (let i = 0; i < 5; i++) {
      const candidate = genGeverNumber();
      const email = geverEmail(candidate);
      const { data, error } = await supabase.auth.signUp({
        email,
        password: pw2,
        options: {
          emailRedirectTo: window.location.origin,
          data: { gever_number: candidate, display_name: name.trim() },
        },
      });
      if (error) {
        if (error.message.toLowerCase().includes("registered")) {
          lastError = error.message;
          continue; // try another number
        }
        setBusy(false);
        return toast.error(friendlyError(error));
      }
      // Success
      setBusy(false);
      if (!data.session) {
        // Email confirmation required (shouldn't be on synthetic but just in case)
        toast.success(`Hesabın oluşturuldu. Gever numaran: ${candidate}`);
      } else {
        toast.success(`Hoş geldin! Gever numaran: ${candidate}`);
      }
      navigate("/", { replace: true });
      return;
    }
    setBusy(false);
    toast.error(lastError || "Hesap oluşturulamadı, tekrar dene");
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-6 py-10 text-foreground">
      <div className="mb-8 flex flex-col items-center gap-3">
        <img src={logo} alt="GEVER" className="h-24 w-24 drop-shadow-[0_0_30px_rgba(99,102,241,0.4)]" />
        <h1 className="text-3xl font-black tracking-[0.35em]">GEVER</h1>
        <p className="text-center text-sm text-muted-foreground">
          Cilo'nun zirvelerinden, sade mesajlaşma.
        </p>
      </div>

      <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-6 grid grid-cols-2 rounded-full bg-secondary p-1">
          <button
            onClick={() => setMode("signin")}
            className={`rounded-full py-2 text-sm font-semibold transition-colors ${
              mode === "signin" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            Giriş
          </button>
          <button
            onClick={() => setMode("signup")}
            className={`rounded-full py-2 text-sm font-semibold transition-colors ${
              mode === "signup" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            Kayıt Ol
          </button>
        </div>

        {mode === "signin" ? (
          <form onSubmit={handleSignIn} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="num">Gever Numarası</Label>
              <Input
                id="num"
                inputMode="numeric"
                pattern="\d{8}"
                maxLength={8}
                placeholder="12345678"
                value={num}
                onChange={(e) => setNum(e.target.value.replace(/\D/g, "").slice(0, 8))}
                className="text-center tracking-[0.4em] text-lg"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pw">Şifre</Label>
              <Input
                id="pw"
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="••••••"
              />
            </div>
            <Button disabled={busy} type="submit" className="h-12 w-full text-base">
              {busy ? "Giriliyor..." : "Giriş Yap"}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleSignUp} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">İsim</Label>
              <Input
                id="name"
                placeholder="Görünen adın"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pw2">Şifre</Label>
              <Input
                id="pw2"
                type="password"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                placeholder="En az 6 karakter"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Kayıt sonrası sana benzersiz bir 8 haneli Gever numarası verilecek.
            </p>
            <Button disabled={busy} type="submit" className="h-12 w-full text-base">
              {busy ? "Oluşturuluyor..." : "Hesap Oluştur"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
