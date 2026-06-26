// Synthesized ringtone / ringback using WebAudio (no asset files).
// startRingtone() -> incoming call (louder, two-tone phone ring)
// startRingback() -> outgoing call (soft repeating beep pair)

let ctx: AudioContext | null = null;
let activeStop: (() => void) | null = null;

function getCtx() {
  if (!ctx) {
    const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(ac: AudioContext, freq: number, start: number, dur: number, gain = 0.18) {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = "sine";
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.02);
  g.gain.setValueAtTime(gain, start + dur - 0.05);
  g.gain.linearRampToValueAtTime(0, start + dur);
  o.connect(g).connect(ac.destination);
  o.start(start);
  o.stop(start + dur + 0.02);
}

function loop(cb: (ac: AudioContext, t: number) => number) {
  stopAll();
  const ac = getCtx();
  let stopped = false;
  let nextAt = ac.currentTime + 0.05;
  let timer: number;
  const tick = () => {
    if (stopped) return;
    while (nextAt < ac.currentTime + 1.5) {
      nextAt += cb(ac, nextAt);
    }
    timer = window.setTimeout(tick, 500);
  };
  tick();
  activeStop = () => {
    stopped = true;
    window.clearTimeout(timer);
  };
}

export function startRingtone() {
  // classic two-burst ring, then 2s silence
  loop((ac, t) => {
    tone(ac, 480, t, 0.4, 0.22);
    tone(ac, 620, t, 0.4, 0.22);
    tone(ac, 480, t + 0.5, 0.4, 0.22);
    tone(ac, 620, t + 0.5, 0.4, 0.22);
    return 3.0;
  });
}

export function startRingback() {
  // soft outgoing beep
  loop((ac, t) => {
    tone(ac, 440, t, 0.35, 0.12);
    tone(ac, 480, t, 0.35, 0.12);
    return 2.5;
  });
}

export function stopAll() {
  if (activeStop) {
    activeStop();
    activeStop = null;
  }
}
