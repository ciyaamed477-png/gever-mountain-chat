import { useEffect, useRef, useState } from "react";
import { friendlyError } from "@/lib/errors";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Send,
  UserPlus,
  MoreVertical,
  Trash2,
  Paperclip,
  Image as ImageIcon,
  Mic,
  X,
  Loader2,
  Phone,
} from "lucide-react";
import { useCall } from "@/components/CallProvider";
import { formatTime } from "@/lib/utils";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Attachment } from "@/components/Attachment";
import PageHead from "@/components/PageHead";

type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string | null;
  created_at: string;
  read_by: string[] | null;
  attachment_url: string | null;
  attachment_type: string | null;
  attachment_name: string | null;
  attachment_size: number | null;
  attachment_duration: number | null;
};
type Header = {
  is_group: boolean;
  title: string;
  subtitle: string;
  avatar_url: string | null;
  other_user_id: string | null;
};

const MSG_COLS =
  "id, conversation_id, sender_id, content, created_at, read_by, attachment_url, attachment_type, attachment_name, attachment_size, attachment_duration";

export default function ChatPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const { startCall } = useCall();
  const [text, setText] = useState("");
  const [header, setHeader] = useState<Header | null>(null);
  const [typing, setTyping] = useState(false);
  const [enterToSend, setEnterToSend] = useState(true);
  const [fontSize, setFontSize] = useState<"sm" | "base" | "lg">("base");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteNum, setInviteNum] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uploading, setUploading] = useState(false);

  // voice recording state
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordStartRef = useRef<number>(0);
  const recordIntervalRef = useRef<number | null>(null);
  const recordCancelledRef = useRef(false);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastTypingSentRef = useRef(0);
  const typingTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem("gever:settings") || "{}");
      if (typeof s.enterToSend === "boolean") setEnterToSend(s.enterToSend);
      if (s.fontSize === "sm" || s.fontSize === "base" || s.fontSize === "lg")
        setFontSize(s.fontSize);
    } catch {
      /* */
    }
  }, []);

  async function loadHeader() {
    if (!conversationId || !user) return;
    const { data: conv } = await supabase
      .from("conversations")
      .select("id, is_group, group_name, group_avatar_url")
      .eq("id", conversationId)
      .maybeSingle();
    if (!conv) {
      toast.error("Sohbet bulunamadı");
      navigate("/");
      return;
    }
    if (conv.is_group) {
      const { count } = await supabase
        .from("conversation_members")
        .select("user_id", { count: "exact", head: true })
        .eq("conversation_id", conversationId);
      setHeader({
        is_group: true,
        title: conv.group_name || "Grup",
        subtitle: `${count ?? 0} üye`,
        avatar_url: conv.group_avatar_url,
        other_user_id: null,
      });
    } else {
      const { data: members } = await supabase
        .from("conversation_members")
        .select("user_id")
        .eq("conversation_id", conversationId);
      const other = members?.find((m) => m.user_id !== user.id)?.user_id ?? null;
      if (other) {
        const { data: p } = await supabase
          .from("profiles")
          .select("display_name, gever_number, avatar_url, status_message")
          .eq("id", other)
          .maybeSingle();
        setHeader({
          is_group: false,
          title: p?.display_name || `#${p?.gever_number ?? ""}`,
          subtitle: p?.status_message || `#${p?.gever_number ?? ""}`,
          avatar_url: p?.avatar_url ?? null,
          other_user_id: other,
        });
      }
    }
  }

  async function loadMessages() {
    if (!conversationId) return;
    const { data } = await supabase
      .from("messages")
      .select(MSG_COLS)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(200);
    setMessages((data as Message[]) || []);
    setTimeout(() => scrollToBottom(), 50);
  }

  async function markRead() {
    if (!conversationId || !user) return;
    await supabase.rpc("mark_conversation_read", { _conversation_id: conversationId });
  }

  function scrollToBottom() {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  useEffect(() => {
    if (!conversationId || !user) return;
    void loadHeader();
    void loadMessages().then(() => void markRead());

    const ch = supabase
      .channel(`chat-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const m = payload.new as Message;
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
          setTimeout(() => scrollToBottom(), 30);
          if (m.sender_id !== user.id) void markRead();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const m = payload.new as Message;
          setMessages((prev) => prev.map((x) => (x.id === m.id ? m : x)));
        },
      )
      .on("broadcast", { event: "typing" }, (payload) => {
        const p = payload.payload as { userId: string };
        if (p.userId !== user.id) {
          setTyping(true);
          if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = window.setTimeout(() => setTyping(false), 2500);
        }
      })
      .subscribe();
    typingChannelRef.current = ch;

    return () => {
      void supabase.removeChannel(ch);
      typingChannelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, user?.id]);

  function broadcastTyping() {
    const now = Date.now();
    if (now - lastTypingSentRef.current < 1500) return;
    lastTypingSentRef.current = now;
    typingChannelRef.current?.send({
      type: "broadcast",
      event: "typing",
      payload: { userId: user?.id },
    });
  }

  async function send() {
    const content = text.trim();
    if (!content || !conversationId || !user) return;
    setText("");
    const { error } = await supabase.from("messages").insert({
      conversation_id: conversationId,
      sender_id: user.id,
      content,
    });
    if (error) {
      toast.error(friendlyError(error));
      setText(content);
    }
  }

  async function uploadAndSend(file: Blob, opts: {
    name: string;
    type: string;
    duration?: number;
  }) {
    if (!conversationId || !user) return;
    if (file.size > 25 * 1024 * 1024) {
      toast.error("Dosya çok büyük (max 25 MB)");
      return;
    }
    setUploading(true);
    try {
      const safeName = opts.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
      const path = `${conversationId}/${user.id}/${Date.now()}-${safeName}`;
      const { error: upErr } = await supabase.storage
        .from("chat-attachments")
        .upload(path, file, { contentType: opts.type, upsert: false });
      if (upErr) throw upErr;
      const { error: insErr } = await supabase.from("messages").insert({
        conversation_id: conversationId,
        sender_id: user.id,
        content: null,
        attachment_url: path,
        attachment_type: opts.type,
        attachment_name: opts.name,
        attachment_size: file.size,
        attachment_duration: opts.duration ?? null,
      });
      if (insErr) throw insErr;
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setUploading(false);
    }
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    void uploadAndSend(f, { name: f.name, type: f.type || "application/octet-stream" });
  }

  async function startRecording() {
    if (recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime =
        MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "audio/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      recordChunksRef.current = [];
      recordCancelledRef.current = false;
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordChunksRef.current.push(ev.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (recordIntervalRef.current) {
          window.clearInterval(recordIntervalRef.current);
          recordIntervalRef.current = null;
        }
        const dur = Math.max(1, Math.round((Date.now() - recordStartRef.current) / 1000));
        setRecording(false);
        setRecordSecs(0);
        if (recordCancelledRef.current) return;
        const blob = new Blob(recordChunksRef.current, { type: mime });
        if (blob.size < 800) {
          toast.error("Çok kısa");
          return;
        }
        const ext = mime.includes("mp4") ? "m4a" : "webm";
        void uploadAndSend(blob, {
          name: `voice-${Date.now()}.${ext}`,
          type: mime,
          duration: dur,
        });
      };
      recorderRef.current = rec;
      recordStartRef.current = Date.now();
      rec.start();
      setRecording(true);
      setRecordSecs(0);
      recordIntervalRef.current = window.setInterval(() => {
        setRecordSecs(Math.round((Date.now() - recordStartRef.current) / 1000));
      }, 250);
    } catch (e) {
      toast.error("Mikrofona erişilemedi");
      console.error(e);
    }
  }

  function stopRecording(cancel = false) {
    if (!recorderRef.current || !recording) return;
    recordCancelledRef.current = cancel;
    try {
      recorderRef.current.stop();
    } catch {
      /* */
    }
  }

  async function inviteToGroup() {
    if (!conversationId) return;
    if (!/^\d{8}$/.test(inviteNum)) return toast.error("8 haneli numara gir");
    const { error } = await supabase.rpc("add_group_member_by_number", {
      _conversation_id: conversationId,
      _gever_number: inviteNum,
    });
    if (error) return toast.error(friendlyError(error));
    toast.success("Eklendi");
    setInviteOpen(false);
    setInviteNum("");
    void loadHeader();
  }

  async function deleteConversation() {
    if (!conversationId) return;
    setConfirmDelete(false);
    const { error } = await supabase.rpc("delete_conversation_for_user", {
      _conversation_id: conversationId,
    });
    if (error) return toast.error(friendlyError(error));
    toast.success("Sohbet silindi");
    navigate("/");
  }

  const fsClass = fontSize === "sm" ? "text-sm" : fontSize === "lg" ? "text-lg" : "text-base";

  function openHeaderProfile() {
    if (header && !header.is_group && header.other_user_id) {
      navigate(`/u/${header.other_user_id}`);
    }
  }

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <PageHead title={`${header?.title || "Sohbet"} · Mesajlaşma · GEVER`} path={`/chat/${conversationId ?? ""}`} />
      <h1 className="sr-only">{`Mesajlaşma — ${header?.title || "Sohbet"}`}</h1>
      <header className="flex items-center gap-3 border-b border-border bg-card px-3 py-3 pt-[max(env(safe-area-inset-top),12px)]">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/")}
          aria-label="Geri"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <button
          type="button"
          onClick={openHeaderProfile}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <Avatar className="h-10 w-10">
            {header?.avatar_url && <AvatarImage src={header.avatar_url} />}
            <AvatarFallback>{(header?.title || "?").slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{header?.title || "Sohbet"}</div>
            <div className="truncate text-xs text-muted-foreground">
              {typing ? "yazıyor…" : header?.subtitle}
            </div>
          </div>
        </button>
        {header && !header.is_group && header.other_user_id && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Sesli ara"
            onClick={() =>
              void startCall({
                id: header.other_user_id!,
                name: header.title,
                avatar: header.avatar_url,
              })
            }
          >
            <Phone className="h-5 w-5" />
          </Button>
        )}
        {header?.is_group && (
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Üye ekle">
                <UserPlus className="h-5 w-5" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Gruba Üye Ekle</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <Input
                  placeholder="8 haneli Gever numarası"
                  value={inviteNum}
                  inputMode="numeric"
                  maxLength={8}
                  onChange={(e) => setInviteNum(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  className="text-center tracking-[0.3em]"
                />
                <Button onClick={inviteToGroup} className="w-full">
                  Ekle
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Daha fazla">
              <MoreVertical className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {header?.is_group ? "Gruptan ayrıl ve sil" : "Sohbeti sil"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <main
        ref={scrollerRef as React.RefObject<HTMLElement>}
        className="flex-1 overflow-y-auto bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.08),transparent_60%)] px-3 py-4"
      >
        <div className="space-y-2">
          {messages.map((m, i) => {
            const mine = m.sender_id === user?.id;
            const prev = messages[i - 1];
            const showSenderHeader =
              header?.is_group && !mine && (!prev || prev.sender_id !== m.sender_id);
            const others = (m.read_by || []).filter((id) => id !== m.sender_id);
            const hasAttachment = !!m.attachment_url;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[78%] rounded-2xl px-3 py-2 ${fsClass} shadow-sm ${
                    mine
                      ? "rounded-br-sm bg-primary text-primary-foreground"
                      : "rounded-bl-sm bg-card text-card-foreground"
                  }`}
                >
                  {showSenderHeader && <GroupSenderName senderId={m.sender_id} />}
                  {hasAttachment && (
                    <div className="mb-1">
                      <Attachment
                        path={m.attachment_url!}
                        type={m.attachment_type}
                        name={m.attachment_name}
                        size={m.attachment_size}
                        duration={m.attachment_duration}
                        mine={mine}
                      />
                    </div>
                  )}
                  {m.content && (
                    <div className="whitespace-pre-wrap break-words">{m.content}</div>
                  )}
                  <div
                    className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${
                      mine ? "text-primary-foreground/70" : "text-muted-foreground"
                    }`}
                  >
                    <span>{formatTime(m.created_at)}</span>
                    {mine &&
                      (others.length > 0 ? (
                        <CheckCheck className="h-3 w-3" />
                      ) : (
                        <Check className="h-3 w-3" />
                      ))}
                  </div>
                </div>
              </div>
            );
          })}
          {messages.length === 0 && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              İlk mesajı sen gönder 👋
            </div>
          )}
        </div>
      </main>


      {recording ? (
        <div className="flex items-center gap-3 border-t border-border bg-card px-3 py-3 pb-[max(env(safe-area-inset-bottom),12px)]">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-destructive" />
          </span>
          <div className="flex-1 text-sm">
            <div className="font-semibold">Kaydediliyor…</div>
            <div className="text-xs text-muted-foreground">
              {formatRec(recordSecs)} • Bırak gönder, sola kaydır iptal
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-11 w-11 rounded-full"
            onClick={() => stopRecording(true)}
            aria-label="İptal"
          >
            <X className="h-5 w-5" />
          </Button>
          <Button
            type="button"
            size="icon"
            className="h-11 w-11 rounded-full"
            onClick={() => stopRecording(false)}
            aria-label="Gönder"
          >
            <Send className="h-5 w-5" />
          </Button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="flex items-end gap-2 border-t border-border bg-card px-2 py-2 pb-[max(env(safe-area-inset-bottom),8px)]"
        >
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={onPickFile}
          />
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onPickFile}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-11 w-11 shrink-0"
                aria-label="Ek"
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Paperclip className="h-5 w-5" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              <DropdownMenuItem onClick={() => imageInputRef.current?.click()}>
                <ImageIcon className="mr-2 h-4 w-4" /> Resim
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                <Paperclip className="mr-2 h-4 w-4" /> Dosya
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              broadcastTyping();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && enterToSend) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder="Mesaj yaz…"
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border border-border bg-background px-4 py-2.5 text-base outline-none focus:border-primary"
          />
          {text.trim() ? (
            <Button
              type="submit"
              size="icon"
              className="h-11 w-11 shrink-0 rounded-full"
              aria-label="Gönder"
            >
              <Send className="h-5 w-5" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              className="h-11 w-11 shrink-0 rounded-full"
              aria-label="Sesli mesaj"
              onPointerDown={(e) => {
                e.preventDefault();
                void startRecording();
              }}
              onPointerUp={() => stopRecording(false)}
              onPointerLeave={() => recording && stopRecording(true)}
              onPointerCancel={() => stopRecording(true)}
            >
              <Mic className="h-5 w-5" />
            </Button>
          )}
        </form>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {header?.is_group ? "Gruptan ayrıl?" : "Sohbeti sil?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {header?.is_group
                ? "Bu gruptan ayrılacaksın ve sohbet listenden kaldırılacak."
                : "Bu sohbet senin için silinecek ve mesaj geçmişi kaldırılacak. Bu işlem geri alınamaz."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Vazgeç</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteConversation}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Sil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function formatRec(s: number) {
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

function GroupSenderName({ senderId }: { senderId: string }) {
  const [name, setName] = useState<string>("");
  const navigate = useNavigate();
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("profiles")
      .select("display_name, gever_number")
      .eq("id", senderId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setName(data?.display_name || `#${data?.gever_number || ""}`);
      });
    return () => {
      cancelled = true;
    };
  }, [senderId]);
  return (
    <button
      type="button"
      onClick={() => navigate(`/u/${senderId}`)}
      className="mb-0.5 block text-left text-xs font-semibold text-primary hover:underline"
    >
      {name}
    </button>
  );
}
