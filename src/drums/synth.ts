// The backing band, made in code with Web Audio on the kit's own clock: a
// warm synth melody, a round bass, and the count-in clicks. Everything goes
// into the kit's mix (so the room's speakers move with it too).

export type Voice = "melody" | "bass" | "click" | "accent";

const freq = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

const LEVEL = { melody: 0.11, bass: 0.3, click: 0.05, accent: 0.075 };

/** Plays one note at audio time `when` for `length` seconds. */
export const playTone = (
  c: AudioContext,
  out: AudioNode,
  voice: Voice,
  midi: number,
  when: number,
  length: number,
  velocity = 0.8,
) => {
  const at = Math.max(c.currentTime, when);
  const g = c.createGain();
  g.gain.value = 0;
  g.connect(out);
  const stops: AudioScheduledSourceNode[] = [];
  const end = at + length;
  if (voice === "click" || voice === "accent") {
    const o = c.createOscillator();
    o.type = "square";
    o.frequency.value = voice === "accent" ? 2000 : 1500;
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 900;
    o.connect(hp).connect(g);
    g.gain.setValueAtTime(LEVEL[voice], at);
    g.gain.setTargetAtTime(0, at + 0.004, 0.012);
    o.start(at);
    o.stop(at + 0.08);
    return;
  }
  if (voice === "melody") {
    // Two soft saws a few cents apart and a triangle, through a warm filter.
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.6;
    lp.frequency.setValueAtTime(900, at);
    lp.frequency.linearRampToValueAtTime(2600, at + 0.03);
    lp.frequency.setTargetAtTime(1500, at + 0.03, 0.3);
    lp.connect(g);
    [-6, 6].forEach((cents) => {
      const o = c.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = freq(midi);
      o.detune.value = cents;
      o.connect(lp);
      stops.push(o);
    });
    const tri = c.createOscillator();
    tri.type = "triangle";
    tri.frequency.value = freq(midi);
    tri.connect(lp);
    stops.push(tri);
    const peak = LEVEL.melody * velocity;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.015);
    g.gain.setTargetAtTime(peak * 0.65, at + 0.015, 0.15);
    g.gain.setTargetAtTime(0, end, 0.08);
  } else {
    // Bass: a sine with a little triangle, plucked.
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 650;
    lp.connect(g);
    const sine = c.createOscillator();
    sine.type = "sine";
    sine.frequency.value = freq(midi);
    sine.connect(lp);
    const tri = c.createOscillator();
    tri.type = "triangle";
    tri.frequency.value = freq(midi);
    const tg = c.createGain();
    tg.gain.value = 0.35;
    tri.connect(tg).connect(lp);
    stops.push(sine, tri);
    const peak = LEVEL.bass * velocity;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.008);
    g.gain.setTargetAtTime(peak * 0.5, at + 0.008, 0.2);
    g.gain.setTargetAtTime(0, end, 0.05);
  }
  stops.forEach((o) => {
    o.start(at);
    o.stop(end + 0.5);
  });
};
