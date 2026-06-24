import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatDay } from "@/lib/utils";
import { MessageSquarePlus, Users, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type ConversationRow = {
  conversation_id: string;
  is_group: boolean;
  group_name: string | null;
  group_avatar_url: string | null;
  other_user_id: string | null;
  other_display_name: string | null;
  other_gever_number: string | null;
  other_avatar_url: string | null;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
};

export default function ChatsPage() {
  const { user, profile } = useAuth();
  const [rows, setRows] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState("");

  async function load() {
    if (!user) return;
    const { data, error } = await supabase.rpc("get_my_conversations");
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    setRows((data as ConversationRow[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    if (!user) return;
    const ch = supabase
      .channel("chats-list")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversation_members" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function createGroup() {
    if (!groupName.trim()) return toast.error("Grup adı gerekli");
    const { data, error } = await supabase.rpc("create_group_conversation", {
      _name: groupName.trim(),
    });
    if (error) return toast.error(error.message);
    toast.success("Grup oluşturuldu");
    setGroupOpen(false);
    setGroupName("");
    void load();
    // navigate is done by the user clicking it
    void data;
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between px-5 pb-3 pt-6">
        <div>
          <h1 className="text-2xl font-black tracking-wider">GEVER</h1>
          {profile && (
            <p className="text-xs text-muted-foreground">
              #{profile.gever_number} · {profile.display_name}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={groupOpen} onOpenChange={setGroupOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Yeni grup">
                <Users className="h-5 w-5" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Yeni Grup</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <Input
                  placeholder="Grup adı"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Önce grubu oluştur, sonra grup sohbetine girerek arkadaşlarını davet edebilirsin.
                </p>
                <Button onClick={createGroup} className="w-full">
                  Grup Oluştur
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Link to="/contacts" aria-label="Yeni sohbet">
            <Button variant="ghost" size="icon">
              <MessageSquarePlus className="h-5 w-5" />
            </Button>
          </Link>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto pb-2">
        {loading ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Yükleniyor…</div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <div className="rounded-full bg-secondary p-6">
              <MessageSquarePlus className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">
              Henüz sohbet yok. Bir kişiyi 8 haneli Gever numarasıyla ekle ve mesajlaşmaya başla.
            </p>
            <Link to="/contacts">
              <Button>Kişi Ekle</Button>
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => {
              const title = r.is_group
                ? r.group_name || "Grup"
                : r.other_display_name || `#${r.other_gever_number ?? ""}`;
              const avatar = r.is_group ? r.group_avatar_url : r.other_avatar_url;
              const initials = (title || "?").slice(0, 2).toUpperCase();
              return (
                <li key={r.conversation_id}>
                  <Link
                    to={`/chat/${r.conversation_id}`}
                    className="flex items-center gap-3 px-5 py-3 active:bg-secondary"
                  >
                    <Avatar className="h-12 w-12">
                      {avatar && <AvatarImage src={avatar} />}
                      <AvatarFallback>{initials}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-semibold">{title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatDay(r.last_message_at)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm text-muted-foreground">
                          {r.last_message || "Sohbet başlatıldı"}
                        </p>
                        {r.unread_count > 0 && (
                          <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
                            {r.unread_count}
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
