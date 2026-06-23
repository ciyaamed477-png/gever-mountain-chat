import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Camera, LogOut, Copy } from "lucide-react";

export default function ProfilePage() {
  const { profile, refreshProfile, signOut, user } = useAuth();
  const [name, setName] = useState("");
  const [status, setStatus] = useState("");
  const [about, setAbout] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (profile) {
      setName(profile.display_name || "");
      setStatus(profile.status_message || "");
      setAbout(profile.about || "");
    }
  }, [profile]);

  async function save() {
    if (!user) return;
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: name.trim() || "Kullanıcı",
        status_message: status.trim() || null,
        about: about.trim() || null,
      })
      .eq("id", user.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Profil güncellendi");
    void refreshProfile();
  }

  async function uploadAvatar(file: File) {
    if (!user) return;
    setBusy(true);
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${user.id}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, {
      upsert: true,
      cacheControl: "3600",
    });
    if (upErr) {
      setBusy(false);
      return toast.error(upErr.message);
    }
    const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
    const { error } = await supabase
      .from("profiles")
      .update({ avatar_url: pub.publicUrl })
      .eq("id", user.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Foto güncellendi");
    void refreshProfile();
  }

  function copyNum() {
    if (!profile) return;
    navigator.clipboard.writeText(profile.gever_number).then(() => toast.success("Kopyalandı"));
  }

  return (
    <div className="h-full overflow-y-auto">
      <header className="px-5 pb-3 pt-6">
        <h1 className="text-2xl font-black tracking-wider">Profil</h1>
      </header>
      <div className="flex flex-col items-center gap-4 px-5 pb-6">
        <div className="relative">
          <Avatar className="h-28 w-28 ring-2 ring-primary/40">
            {profile?.avatar_url && <AvatarImage src={profile.avatar_url} />}
            <AvatarFallback className="text-3xl">
              {(profile?.display_name || "?").slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <label className="absolute bottom-0 right-0 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
            <Camera className="h-4 w-4" />
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadAvatar(f);
              }}
            />
          </label>
        </div>
        <button
          onClick={copyNum}
          className="flex items-center gap-2 rounded-full bg-secondary px-4 py-2 text-sm font-semibold tracking-widest text-secondary-foreground"
        >
          <span>#{profile?.gever_number}</span>
          <Copy className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4 px-5 pb-10">
        <div className="space-y-2">
          <Label>İsim</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </div>
        <div className="space-y-2">
          <Label>Durum mesajı</Label>
          <Input
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="Müsait"
            maxLength={80}
          />
        </div>
        <div className="space-y-2">
          <Label>Hakkımda</Label>
          <Textarea
            value={about}
            onChange={(e) => setAbout(e.target.value)}
            rows={4}
            maxLength={300}
            placeholder="Kısa bir biyografi…"
          />
        </div>
        <Button disabled={busy} onClick={save} className="h-12 w-full">
          Kaydet
        </Button>
        <Button variant="outline" onClick={signOut} className="h-12 w-full">
          <LogOut className="mr-2 h-4 w-4" /> Çıkış Yap
        </Button>
      </div>
    </div>
  );
}
