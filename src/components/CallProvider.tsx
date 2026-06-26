import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import { startRingback, startRingtone, stopAll as stopAllRings } from "@/lib/ringtone";
import { toast } from "sonner";

type CallState =
  | { phase: "idle" }
  | {
      phase: "incoming" | "outgoing" | "connecting" | "active";
      callId: string;
      peerId: string;
      peerName: string;
      peerAvatar: string | null;
      isCaller: boolean;
      startedAt?: number;
    };

type StartCall = (peer: { id: string; name: string; avatar: string | null }) => Promise<void>;

type CallCtx = {
  state: CallState;
  startCall: StartCall;
};

const Ctx = createContext<CallCtx | null>(null);

export function useCall() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCall outside CallProvider");
  return c;
}

type SignalEvent =
  | { type: "invite"; callId: string; fromId: string; fromName: string; fromAvatar: string | null }
  | { type: "accept"; callId: string; fromId: string }
  | { type: "decline"; callId: string; fromId: string }
  | { type: "hangup"; callId: string; fromId: string }
  | { type: "sdp"; callId: string; fromId: string; sdp: RTCSessionDescriptionInit }
  | { type: "ice"; callId: string; fromId: string; candidate: RTCIceCandidateInit };

async function getIceServers(): Promise<RTCIceServer[]> {
  try {
    const { data, error } = await supabase.functions.invoke("ice-servers");
    if (error) throw error;
    const servers = (data as { iceServers?: RTCIceServer[] })?.iceServers;
    if (Array.isArray(servers) && servers.length) return servers;
  } catch (e) {
    console.warn("ice-servers fetch failed, using STUN", e);
  }
  return [{ urls: "stun:stun.l.google.com:19302" }];
}

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [state, setState] = useState<CallState>({ phase: "idle" });
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const inboxRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const callChRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const stateRef = useRef<CallState>(state);
  stateRef.current = state;

  // tick timer for active call
  useEffect(() => {
    if (state.phase !== "active" || !state.startedAt) return;
    const id = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - (state.startedAt ?? Date.now())) / 1000)),
      500,
    );
    return () => window.clearInterval(id);
  }, [state]);

  const cleanup = useCallback(() => {
    stopAllRings();
    if (callChRef.current) {
      void supabase.removeChannel(callChRef.current);
      callChRef.current = null;
    }
    if (pcRef.current) {
      try {
        pcRef.current.getSenders().forEach((s) => s.track?.stop());
        pcRef.current.close();
      } catch {
        /* */
      }
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (audioElRef.current) {
      audioElRef.current.srcObject = null;
    }
    pendingIceRef.current = [];
    setMuted(false);
    setElapsed(0);
    setState({ phase: "idle" });
  }, []);

  const sendToPeer = useCallback(async (peerId: string, evt: SignalEvent) => {
    const ch = supabase.channel(`call-inbox:${peerId}`, {
      config: { broadcast: { ack: false } },
    });
    await new Promise<void>((resolve) => {
      ch.subscribe((status) => {
        if (status === "SUBSCRIBED") resolve();
      });
    });
    await ch.send({ type: "broadcast", event: "signal", payload: evt });
    setTimeout(() => void supabase.removeChannel(ch), 500);
  }, []);

  const buildPc = useCallback(
    async (peerId: string, callId: string, isCaller: boolean) => {
      const iceServers = await getIceServers();
      const pc = new RTCPeerConnection({ iceServers });
      pcRef.current = pc;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      pc.ontrack = (ev) => {
        const remote = ev.streams[0];
        if (!audioElRef.current) {
          const a = document.createElement("audio");
          a.autoplay = true;
          a.style.display = "none";
          document.body.appendChild(a);
          audioElRef.current = a;
        }
        audioElRef.current.srcObject = remote;
        void audioElRef.current.play().catch(() => {});
      };

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          void sendToPeer(peerId, {
            type: "ice",
            callId,
            fromId: user!.id,
            candidate: ev.candidate.toJSON(),
          });
        }
      };

      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        if (s === "connected") {
          stopAllRings();
          setState((prev) =>
            prev.phase === "idle"
              ? prev
              : { ...prev, phase: "active", startedAt: prev.startedAt ?? Date.now() },
          );
        } else if (s === "failed" || s === "disconnected" || s === "closed") {
          if (stateRef.current.phase !== "idle") {
            toast.message("Bağlantı koptu");
            cleanup();
          }
        }
      };

      return pc;
    },
    [cleanup, sendToPeer, user],
  );

  // Subscribe to inbox for incoming calls + per-call signaling
  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel(`call-inbox:${user.id}`);
    ch.on("broadcast", { event: "signal" }, async ({ payload }) => {
      const evt = payload as SignalEvent;
      const cur = stateRef.current;

      // INVITE — only when idle
      if (evt.type === "invite") {
        if (cur.phase !== "idle") {
          // busy → decline back
          void sendToPeer(evt.fromId, {
            type: "decline",
            callId: evt.callId,
            fromId: user.id,
          });
          return;
        }
        setState({
          phase: "incoming",
          callId: evt.callId,
          peerId: evt.fromId,
          peerName: evt.fromName,
          peerAvatar: evt.fromAvatar,
          isCaller: false,
        });
        try {
          startRingtone();
        } catch {
          /* */
        }
        if (document.hidden && "Notification" in window && Notification.permission === "granted") {
          try {
            new Notification(`Gelen arama: ${evt.fromName}`, { body: "Sesli arama" });
          } catch {
            /* */
          }
        }
        return;
      }

      // For everything else, the call must be the current one
      if (cur.phase === "idle" || cur.callId !== evt.callId) return;

      if (evt.type === "accept" && cur.isCaller) {
        // callee accepted → create offer
        stopAllRings();
        setState((p) => (p.phase === "idle" ? p : { ...p, phase: "connecting" }));
        const pc = await buildPc(cur.peerId, cur.callId, true);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        void sendToPeer(cur.peerId, {
          type: "sdp",
          callId: cur.callId,
          fromId: user.id,
          sdp: offer,
        });
        return;
      }

      if (evt.type === "decline") {
        toast.message("Çağrı reddedildi");
        cleanup();
        return;
      }

      if (evt.type === "hangup") {
        toast.message("Çağrı sonlandı");
        cleanup();
        return;
      }

      if (evt.type === "sdp") {
        let pc = pcRef.current;
        if (!pc) pc = await buildPc(cur.peerId, cur.callId, cur.isCaller);
        await pc.setRemoteDescription(evt.sdp);
        // flush queued ICE
        for (const c of pendingIceRef.current) {
          try {
            await pc.addIceCandidate(c);
          } catch {
            /* */
          }
        }
        pendingIceRef.current = [];
        if (evt.sdp.type === "offer") {
          const ans = await pc.createAnswer();
          await pc.setLocalDescription(ans);
          void sendToPeer(cur.peerId, {
            type: "sdp",
            callId: cur.callId,
            fromId: user.id,
            sdp: ans,
          });
        }
        return;
      }

      if (evt.type === "ice") {
        const pc = pcRef.current;
        if (!pc || !pc.remoteDescription) {
          pendingIceRef.current.push(evt.candidate);
        } else {
          try {
            await pc.addIceCandidate(evt.candidate);
          } catch (e) {
            console.warn("addIceCandidate", e);
          }
        }
      }
    });
    ch.subscribe();
    inboxRef.current = ch;
    return () => {
      void supabase.removeChannel(ch);
      inboxRef.current = null;
    };
  }, [user, buildPc, cleanup, sendToPeer]);

  const startCall = useCallback<StartCall>(
    async (peer) => {
      if (!user) return;
      if (stateRef.current.phase !== "idle") {
        toast.error("Zaten devam eden bir çağrı var");
        return;
      }
      if (peer.id === user.id) return;
      // Request notification perms early
      if ("Notification" in window && Notification.permission === "default") {
        try {
          void Notification.requestPermission();
        } catch {
          /* */
        }
      }
      // Probe mic permission early so we fail fast
      try {
        const test = await navigator.mediaDevices.getUserMedia({ audio: true });
        test.getTracks().forEach((t) => t.stop());
      } catch {
        toast.error("Mikrofon izni gerekli");
        return;
      }

      const callId = crypto.randomUUID();
      // Get my profile for display on callee side
      const { data: me } = await supabase
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("id", user.id)
        .maybeSingle();

      setState({
        phase: "outgoing",
        callId,
        peerId: peer.id,
        peerName: peer.name,
        peerAvatar: peer.avatar,
        isCaller: true,
      });
      try {
        startRingback();
      } catch {
        /* */
      }
      await sendToPeer(peer.id, {
        type: "invite",
        callId,
        fromId: user.id,
        fromName: me?.display_name || "Bilinmeyen",
        fromAvatar: me?.avatar_url ?? null,
      });

      // auto-cancel after 35s if no accept
      window.setTimeout(() => {
        const cur = stateRef.current;
        if (cur.phase === "outgoing" && cur.callId === callId) {
          toast.message("Cevap verilmedi");
          void sendToPeer(peer.id, { type: "hangup", callId, fromId: user.id });
          cleanup();
        }
      }, 35000);
    },
    [user, sendToPeer, cleanup],
  );

  const accept = useCallback(async () => {
    const cur = stateRef.current;
    if (cur.phase !== "incoming") return;
    stopAllRings();
    setState((p) => (p.phase === "idle" ? p : { ...p, phase: "connecting" }));
    // Pre-build PC so we are ready for the offer
    await buildPc(cur.peerId, cur.callId, false);
    await sendToPeer(cur.peerId, {
      type: "accept",
      callId: cur.callId,
      fromId: user!.id,
    });
  }, [buildPc, sendToPeer, user]);

  const decline = useCallback(async () => {
    const cur = stateRef.current;
    if (cur.phase === "idle") return;
    await sendToPeer(cur.peerId, {
      type: cur.phase === "incoming" ? "decline" : "hangup",
      callId: cur.callId,
      fromId: user!.id,
    });
    cleanup();
  }, [sendToPeer, cleanup, user]);

  const toggleMute = useCallback(() => {
    const s = localStreamRef.current;
    if (!s) return;
    const next = !muted;
    s.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMuted(next);
  }, [muted]);

  const ctx = useMemo<CallCtx>(() => ({ state, startCall }), [state, startCall]);

  return (
    <Ctx.Provider value={ctx}>
      {children}
      {state.phase !== "idle" && (
        <CallOverlay
          state={state}
          muted={muted}
          elapsed={elapsed}
          onAccept={accept}
          onDecline={decline}
          onToggleMute={toggleMute}
        />
      )}
    </Ctx.Provider>
  );
}

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function CallOverlay({
  state,
  muted,
  elapsed,
  onAccept,
  onDecline,
  onToggleMute,
}: {
  state: CallState;
  muted: boolean;
  elapsed: number;
  onAccept: () => void;
  onDecline: () => void;
  onToggleMute: () => void;
}) {
  if (state.phase === "idle") return null;
  const status =
    state.phase === "incoming"
      ? "Gelen sesli arama"
      : state.phase === "outgoing"
      ? "Çağrılıyor…"
      : state.phase === "connecting"
      ? "Bağlanıyor…"
      : fmtTime(elapsed);

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-gradient-to-b from-emerald-950 via-slate-950 to-black text-white">
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 pt-[env(safe-area-inset-top)]">
        <Avatar className="h-32 w-32 ring-4 ring-emerald-700/40">
          {state.peerAvatar && <AvatarImage src={state.peerAvatar} />}
          <AvatarFallback className="text-3xl">
            {(state.peerName || "?").slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="text-center">
          <div className="text-2xl font-semibold">{state.peerName}</div>
          <div className="mt-2 text-sm text-emerald-200/80">{status}</div>
        </div>
      </div>
      <div className="flex items-center justify-center gap-6 px-6 pb-[max(env(safe-area-inset-bottom),24px)] pt-6">
        {state.phase === "incoming" ? (
          <>
            <Button
              size="lg"
              onClick={onDecline}
              className="h-16 w-16 rounded-full bg-red-600 p-0 hover:bg-red-700"
              aria-label="Reddet"
            >
              <PhoneOff className="h-7 w-7" />
            </Button>
            <Button
              size="lg"
              onClick={onAccept}
              className="h-16 w-16 rounded-full bg-emerald-600 p-0 hover:bg-emerald-700"
              aria-label="Kabul et"
            >
              <Phone className="h-7 w-7" />
            </Button>
          </>
        ) : (
          <>
            <Button
              size="lg"
              variant="secondary"
              onClick={onToggleMute}
              className="h-14 w-14 rounded-full p-0"
              aria-label={muted ? "Sesi aç" : "Sustur"}
            >
              {muted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
            </Button>
            <Button
              size="lg"
              onClick={onDecline}
              className="h-16 w-16 rounded-full bg-red-600 p-0 hover:bg-red-700"
              aria-label="Bitir"
            >
              <PhoneOff className="h-7 w-7" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
