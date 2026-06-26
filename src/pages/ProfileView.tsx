import { useEffect, useState } from "react";
import { friendlyError } from "@/lib/errors";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MessageSquare, UserPlus, Ban, Copy } from "lucide-react";
import PageHead from "@/components/PageHead";
import { toast } from "sonner";

type Profile = {
  id: string;
  display_name: string;
  gever_number: string;
  avatar_url: string | null;
  status_message: string | null;
  about: string | null;
};

export default function ProfileViewPage() {
  const { userId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [p, setP] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLoading(true);
    supabase
      .from("profiles")
      .select("id, display_name, gever_number, avatar_url, status_message, about")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) {
          setP((data as Profile) || null);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function startDM() {
    if (!userId) return;
    const { data, error } = await supabase.rpc("get_or_create_direct_conversation", {
      _other_user_id: userId,
    });
    if (error) return toast.error(friendlyError(error));
    navigate(`/chat/${data as string}`);
  }

  async function addContact() {
    if (!p) return;
    const { error } = await supabase.rpc("add_contact_by_number", {
      _gever_number: p.gever_number,
    });
    if (error) return toast.error(friendlyError(error));
    toast.success("Kişi eklendi");
  }

  async function block() {
    if (!userId) return;
    const { error } = await supabase.rpc("block_user", { _other_user_id: userId });
    if (error) return toast.error(friendlyError(error));
    toast.success("Engellendi");
  }

  function copyNum() {
    if (!p) return;
    navigator.clipboard.writeText(p.gever_number).then(() => toast.success("Kopyalandı"));
  }

  const isMe = user?.id === userId;

  return (
    <div className="flex h-dvh flex-col bg-background">
      <PageHead title={`${profile?.display_name || "Kullanıcı"} profili · GEVER`} path={`/u/${userId ?? ""}`} />
      <header className="flex items-center gap-2 border-b border-border bg-card px-3 py-3 pt-[max(env(safe-area-inset-top),12px)]">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Geri">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-bold">Profil</h1>
      </header>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">Yükleniyor…</p>
        ) : !p ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            Kullanıcı bulunamadı.
          </p>
        ) : (
          <>
            <div className="flex flex-col items-center gap-3 px-5 py-8">
              <Avatar className="h-32 w-32 ring-4 ring-primary/30">
                {p.avatar_url && <AvatarImage src={p.avatar_url} />}
                <AvatarFallback className="text-4xl">
                  {(p.display_name || "?").slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <h2 className="text-2xl font-bold">{p.display_name}</h2>
              <button
                onClick={copyNum}
                className="flex items-center gap-2 rounded-full bg-secondary px-4 py-1.5 text-sm font-semibold tracking-widest text-secondary-foreground"
              >
                <span>#{p.gever_number}</span>
                <Copy className="h-3.5 w-3.5" />
              </button>
              {p.status_message && (
                <p className="text-center text-sm italic text-muted-foreground">
                  "{p.status_message}"
                </p>
              )}
            </div>

            {p.about && (
              <div className="mx-5 mb-6 rounded-2xl border border-border bg-card p-4">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Hakkında
                </div>
                <p className="whitespace-pre-wrap text-sm">{p.about}</p>
              </div>
            )}

            {!isMe && (
              <div className="space-y-2 px-5 pb-10">
                <Button onClick={startDM} className="h-12 w-full">
                  <MessageSquare className="mr-2 h-5 w-5" /> Mesaj Gönder
                </Button>
                <Button variant="outline" onClick={addContact} className="h-12 w-full">
                  <UserPlus className="mr-2 h-5 w-5" /> Kişilere Ekle
                </Button>
                <Button
                  variant="ghost"
                  onClick={block}
                  className="h-12 w-full text-destructive hover:text-destructive"
                >
                  <Ban className="mr-2 h-5 w-5" /> Engelle
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
