import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Download, File as FileIcon, Play, Pause, Loader2 } from "lucide-react";

// In-memory cache for signed URLs (per session)
const urlCache = new Map<string, { url: string; exp: number }>();

async function getSignedUrl(path: string): Promise<string | null> {
  const now = Date.now();
  const cached = urlCache.get(path);
  if (cached && cached.exp > now + 60_000) return cached.url;
  const { data, error } = await supabase.storage
    .from("chat-attachments")
    .createSignedUrl(path, 60 * 60); // 1 hour
  if (error || !data) return null;
  urlCache.set(path, { url: data.signedUrl, exp: now + 60 * 60 * 1000 });
  return data.signedUrl;
}

export function Attachment({
  path,
  type,
  name,
  size,
  duration,
  mine,
}: {
  path: string;
  type: string | null;
  name: string | null;
  size: number | null;
  duration: number | null;
  mine: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getSignedUrl(path).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!url) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs opacity-70">
        <Loader2 className="h-3 w-3 animate-spin" /> Yükleniyor…
      </div>
    );
  }

  if (type?.startsWith("image/")) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block">
        <img
          src={url}
          alt={name || "image"}
          className="max-h-72 w-full max-w-[260px] rounded-lg object-cover"
          loading="lazy"
        />
      </a>
    );
  }

  if (type?.startsWith("audio/")) {
    return <VoicePlayer url={url} duration={duration} mine={mine} />;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      download={name || undefined}
      className={`flex items-center gap-2 rounded-lg px-2 py-2 ${
        mine ? "bg-primary-foreground/10" : "bg-muted"
      }`}
    >
      <FileIcon className="h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{name || "Dosya"}</div>
        {size != null && (
          <div className="text-[10px] opacity-70">{formatSize(size)}</div>
        )}
      </div>
      <Download className="h-4 w-4 opacity-70" />
    </a>
  );
}

function VoicePlayer({
  url,
  duration,
  mine,
}: {
  url: string;
  duration: number | null;
  mine: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const a = new Audio(url);
    audioRef.current = a;
    const onTime = () => {
      if (a.duration) setProgress(a.currentTime / a.duration);
    };
    const onEnd = () => {
      setPlaying(false);
      setProgress(0);
    };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", onEnd);
    return () => {
      a.pause();
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("ended", onEnd);
    };
  }, [url]);

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      void a.play();
      setPlaying(true);
    }
  }

  return (
    <div className="flex min-w-[180px] items-center gap-2 py-1">
      <button
        type="button"
        onClick={toggle}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
          mine ? "bg-primary-foreground/20" : "bg-primary text-primary-foreground"
        }`}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      <div className="flex-1">
        <div className={`h-1 w-full rounded-full ${mine ? "bg-primary-foreground/20" : "bg-muted"}`}>
          <div
            className={`h-full rounded-full ${mine ? "bg-primary-foreground" : "bg-primary"}`}
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <div className="mt-1 text-[10px] opacity-70">
          {duration ? formatDuration(duration) : "—"}
        </div>
      </div>
    </div>
  );
}

function formatSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
