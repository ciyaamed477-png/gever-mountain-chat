import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageSquare, Trash2, UserPlus, Ban, RotateCcw, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
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

type Contact = {
  contact_id: string;
  display_name: string;
  gever_number: string;
  avatar_url: string | null;
};
type Blocked = {
  blocked_id: string;
  display_name: string;
  gever_number: string;
  avatar_url: string | null;
};

export default function ContactsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [num, setNum] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [blocked, setBlocked] = useState<Blocked[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<Contact | null>(null);

  async function load() {
    const [c, b] = await Promise.all([
      supabase.rpc("get_my_contacts"),
      supabase.rpc("get_my_blocked"),
    ]);
    if (!c.error) setContacts((c.data as Contact[]) || []);
    if (!b.error) setBlocked((b.data as Blocked[]) || []);
  }
  useEffect(() => {
    if (user) void load();
  }, [user]);

  async function addContact() {
    if (!/^\d{8}$/.test(num)) return toast.error("8 haneli numara gir");
    setBusy(true);
    const { error } = await supabase.rpc("add_contact_by_number", { _gever_number: num });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Kişi eklendi");
    setNum("");
    void load();
  }

  async function startDM(otherId: string) {
    const { data, error } = await supabase.rpc("get_or_create_direct_conversation", {
      _other_user_id: otherId,
    });
    if (error) return toast.error(error.message);
    navigate(`/chat/${data as string}`);
  }

  async function removeContact(otherId: string) {
    const { error } = await supabase.rpc("remove_contact", { _other_user_id: otherId });
    if (error) return toast.error(error.message);
    void load();
  }

  async function block(otherId: string) {
    const { error } = await supabase.rpc("block_user", { _other_user_id: otherId });
    if (error) return toast.error(error.message);
    toast.success("Kullanıcı engellendi");
    void load();
  }
  async function unblock(otherId: string) {
    const { error } = await supabase.rpc("unblock_user", { _other_user_id: otherId });
    if (error) return toast.error(error.message);
    toast.success("Engel kaldırıldı");
    void load();
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 px-3 pb-3 pt-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(-1)}
          aria-label="Geri"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-black tracking-wider">Kişiler</h1>
      </header>

      <div className="px-5">
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="mb-3 text-sm text-muted-foreground">
            Bir kişiyi 8 haneli Gever numarasıyla ekle.
          </p>
          <div className="flex gap-2">
            <Input
              inputMode="numeric"
              maxLength={8}
              placeholder="12345678"
              value={num}
              onChange={(e) => setNum(e.target.value.replace(/\D/g, "").slice(0, 8))}
              className="text-center tracking-[0.4em]"
            />
            <Button onClick={addContact} disabled={busy}>
              <UserPlus className="mr-1 h-4 w-4" /> Ekle
            </Button>
          </div>
        </div>
      </div>

      <Tabs defaultValue="contacts" className="mt-4 flex-1 overflow-hidden">
        <TabsList className="mx-5 grid grid-cols-2">
          <TabsTrigger value="contacts">Kişilerim ({contacts.length})</TabsTrigger>
          <TabsTrigger value="blocked">Engelliler ({blocked.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="contacts" className="mt-3 h-full overflow-y-auto pb-4">
          {contacts.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              Henüz kişin yok.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {contacts.map((c) => (
                <li key={c.contact_id} className="flex items-center gap-3 px-5 py-3">
                  <Avatar className="h-11 w-11">
                    {c.avatar_url && <AvatarImage src={c.avatar_url} />}
                    <AvatarFallback>{c.display_name.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{c.display_name}</div>
                    <div className="text-xs text-muted-foreground">#{c.gever_number}</div>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => startDM(c.contact_id)} aria-label="Mesaj">
                    <MessageSquare className="h-5 w-5" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => block(c.contact_id)} aria-label="Engelle">
                    <Ban className="h-5 w-5" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => removeContact(c.contact_id)} aria-label="Sil">
                    <Trash2 className="h-5 w-5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="blocked" className="mt-3 h-full overflow-y-auto pb-4">
          {blocked.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              Engelli kullanıcı yok.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {blocked.map((b) => (
                <li key={b.blocked_id} className="flex items-center gap-3 px-5 py-3">
                  <Avatar className="h-11 w-11">
                    {b.avatar_url && <AvatarImage src={b.avatar_url} />}
                    <AvatarFallback>{b.display_name.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{b.display_name}</div>
                    <div className="text-xs text-muted-foreground">#{b.gever_number}</div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => unblock(b.blocked_id)}>
                    <RotateCcw className="mr-1 h-4 w-4" /> Kaldır
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
