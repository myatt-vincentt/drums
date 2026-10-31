// The drum sounds: a recorded kit, played with Web Audio.
//
// Every piece has several velocity layers (soft to hard takes of the real
// drum), some with two takes per layer that alternate. A hit picks the layer
// from how hard it was, with a small random variation in level and pitch so
// repeated hits never sound machine-gunned. Closing the hi-hat chokes the
// open hi-hat's ring. Everything goes through a gentle limiter so a busy fill
// never clips. Silent until the first tap (browsers only start audio on one);
// the files load and decode straight away so that tap plays at once.
//
//   voice → piece bus → master → limiter → speakers
import type { SoundId } from "./pieces";

type Layer = { files: string[]; level: number };
type Manifest = { pieces: Partial<Record<SoundId, Layer[]>> };

const BASE = "/sounds/";

/** Each sound's level in the mix (the files are already matched). */
const MIX: Record<SoundId, number> = {
  kick: 1,
  snare: 1,
  tom1: 1,
  tom2: 1,
  crash: 0.9,
  hihatClosed: 1,
  hihatSemi: 1,
  hihatOpen: 1,
  hihatPedal: 1,
};
const MASTER = 1.6;
/** The open hi-hat sounds a close cuts short. */
const CHOKED: SoundId[] = ["hihatOpen", "hihatSemi"];
/** Most voices one sound keeps ringing at once. */
const MAX_VOICES = 6;

type Take = { buffer: AudioBuffer; offset: number };
type Voice = { src: AudioBufferSourceNode; gain: GainNode; sound: SoundId };

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let loading: Promise<void> | null = null;
let unlocked = false;
const takes = new Map<SoundId, { takes: Take[][]; levels: number[] }>();
const turn = new Map<string, number>();
const voices: Voice[] = [];

/** Level meter and event log (read by the development debug object). */
export const meter = {
  loaded: 0,
  total: 0,
  unlocked: false,
  events: [] as Array<{
    t: number;
    sound: SoundId;
    layer: number;
    gain: number;
  }>,
};

let analyser: AnalyserNode | null = null;
let wave: Float32Array | null = null;
let bins: Uint8Array | null = null;
/** What the room's speakers show: overall level and the low end (0..1, eased). */
const out = { level: 0, low: 0 };
/** Speaker motion: rise fast, fall back over this long (s). */
const RELEASE = 0.16;

const makeContext = () => {
  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) return null;
  const c = new AC({ latencyHint: "interactive" });
  master = c.createGain();
  master.gain.value = MASTER;
  const limiter = c.createDynamicsCompressor();
  limiter.threshold.value = -4;
  limiter.knee.value = 3;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.15;
  // A meter on what goes out (the speakers in the room move with it).
  analyser = c.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0;
  wave = new Float32Array(analyser.fftSize);
  bins = new Uint8Array(analyser.frequencyBinCount);
  master.connect(limiter).connect(analyser).connect(c.destination);
  return c;
};

/**
 * Where the hit starts in a decoded file: the compressed format adds a few
 * milliseconds of silence at the front, which would make every hit late.
 */
const onsetOf = (b: AudioBuffer) => {
  const data = b.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < data.length; i += 1)
    peak = Math.max(peak, Math.abs(data[i]));
  const th = peak * 0.02;
  for (let i = 0; i < data.length; i += 1) {
    if (Math.abs(data[i]) >= th) return Math.max(0, i / b.sampleRate - 0.0005);
  }
  return 0;
};

const decode = (c: AudioContext, bytes: ArrayBuffer) =>
  new Promise<AudioBuffer>((resolve, reject) => {
    // The callback form also works on older Safari.
    c.decodeAudioData(bytes, resolve, reject);
  });

const load = async (c: AudioContext) => {
  const res = await fetch(`${BASE}kit.json`);
  const manifest = (await res.json()) as Manifest;
  const entries = Object.entries(manifest.pieces) as [SoundId, Layer[]][];
  meter.total = entries.reduce(
    (n, [, layers]) => n + layers.reduce((m, l) => m + l.files.length, 0),
    0,
  );
  await Promise.all(
    entries.map(async ([sound, layers]) => {
      const loaded = await Promise.all(
        layers.map((layer) =>
          Promise.all(
            layer.files.map(async (file) => {
              const r = await fetch(`${BASE}${file}`);
              const buffer = await decode(c, await r.arrayBuffer());
              meter.loaded += 1;
              return { buffer, offset: onsetOf(buffer) };
            }),
          ),
        ),
      );
      takes.set(sound, { takes: loaded, levels: layers.map((l) => l.level) });
    }),
  );
};

const stopVoice = (v: Voice, at: number, fade: number) => {
  v.gain.gain.cancelScheduledValues(at);
  v.gain.gain.setValueAtTime(v.gain.gain.value, at);
  v.gain.gain.setTargetAtTime(0, at, fade / 3);
  try {
    v.src.stop(at + fade + 0.05);
  } catch {
    // already stopped
  }
};

export const sound = {
  /**
   * The output's level and its low end (kick, toms) right now, each 0..1:
   * quick to rise, easing back over about 0.16 s. Silent is 0.
   */
  levels(dt: number) {
    if (!analyser || !wave || !bins || !ctx || ctx.state !== "running") {
      out.level = 0;
      out.low = 0;
      return out;
    }
    analyser.getFloatTimeDomainData(wave as Float32Array<ArrayBuffer>);
    let sum = 0;
    for (let i = 0; i < wave.length; i += 1) sum += wave[i] * wave[i];
    const rms = Math.sqrt(sum / wave.length);
    analyser.getByteFrequencyData(bins as Uint8Array<ArrayBuffer>);
    // The bins below about 150 Hz.
    const top = Math.max(
      1,
      Math.round((150 / (ctx.sampleRate / 2)) * bins.length),
    );
    let low = 0;
    for (let i = 1; i <= top; i += 1) low = Math.max(low, bins[i] / 255);
    const level = Math.min(1, rms * 3.2);
    const lowNow = Math.max(0, (low - 0.6) / 0.4);
    const fall = Math.exp(-dt / (RELEASE / 3));
    out.level = level > out.level ? level : out.level * fall;
    out.low = lowNow > out.low ? lowNow : out.low * fall;
    return out;
  },

  meter,

  /** Start loading and decoding (no sound yet). */
  preload() {
    if (loading) return;
    ctx = makeContext();
    if (!ctx) return;
    loading = load(ctx).catch(() => {
      loading = null;
    });
  },

  /** The first tap: let the sound play. */
  unlock() {
    if (!ctx) this.preload();
    if (!ctx) return;
    // Play through the phone's silent switch, like a music app.
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    try {
      if (nav.audioSession) nav.audioSession.type = "playback";
    } catch {
      // not supported
    }
    if (ctx.state !== "running") void ctx.resume();
    unlocked = true;
    meter.unlocked = true;
  },

  get unlocked() {
    return unlocked;
  },

  /** Play a hit; `velocity` 0..1 picks the layer and the level. */
  play(id: SoundId, velocity: number) {
    const c = ctx;
    const set = takes.get(id);
    if (!c || !master || !unlocked || !set) return;
    const v = Math.min(1, Math.max(0, velocity));
    const n = set.takes.length;
    // The layer, with a little random spread between neighbours.
    const layer = Math.min(
      n - 1,
      Math.max(0, Math.round(v * (n - 1) + (Math.random() - 0.5) * 0.4)),
    );
    const variants = set.takes[layer];
    const key = `${id}:${layer}`;
    const k = ((turn.get(key) ?? -1) + 1) % variants.length;
    turn.set(key, k);
    const take = variants[k];

    // Level: the layer is already as loud as the real hit; this smooths the
    // steps between layers and adds a slight human variation (±0.6 dB).
    const between = v * (n - 1) - layer;
    const gain =
      MIX[id] *
      (0.82 + 0.18 * v) *
      (1 + between * 0.12) *
      10 ** (((Math.random() - 0.5) * 1.2) / 20);
    const at = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = take.buffer;
    // ±15 cents.
    src.playbackRate.value = 2 ** (((Math.random() - 0.5) * 0.3) / 12);
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(g).connect(master);
    src.start(at, take.offset);
    const voice = { src, gain: g, sound: id };
    voices.push(voice);
    src.onended = () => {
      const i = voices.indexOf(voice);
      if (i >= 0) voices.splice(i, 1);
    };
    const same = voices.filter((x) => x.sound === id);
    if (same.length > MAX_VOICES) stopVoice(same[0], at, 0.03);

    meter.events.push({
      t: Number(at.toFixed(3)),
      sound: id,
      layer,
      gain: Number(gain.toFixed(2)),
    });
    if (meter.events.length > 60) meter.events.shift();
  },

  /** The hi-hat closed: cut the open hi-hat's ring short. */
  choke() {
    if (!ctx) return;
    const at = ctx.currentTime;
    voices
      .filter((v) => CHOKED.includes(v.sound))
      .forEach((v) => stopVoice(v, at, 0.06));
  },
};
