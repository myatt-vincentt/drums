// Learn mode: playing along with a song or a beat.
//
// A glowing ring sits on the next piece to hit and shrinks to the head's
// rim on the beat (hit as it meets the rim), with a faint ring on the piece
// after it. Learn waits at each note; Play runs in time and answers each hit:
// a gold burst for a perfect one, small sparkles for a good one, nothing for
// a miss. At the end: stars, confetti over the kit, a big hit on the amps.
// The backing (synth melody and bass, count-in clicks) runs on the same
// audio clock as the drums.
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Quaternion,
  RingGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
} from "three";

import { sound } from "./audio";
import { easeOut } from "./fx";
import type { PieceId } from "./pieces";
import { COUNT_IN_BARS, Session, type Mode } from "./session";
import { CHARTS, chartById, type Chart } from "./songs";
import { drums, headOf } from "./state";
import { playTone, type ToneHandle, type Voice } from "./synth";

/** Play's slower speed. */
const SLOW = 0.75;
/** How far ahead (s) the backing is scheduled. */
const LOOKAHEAD = 0.15;
/** The target ring starts this many beats before its note, this much wider. */
const APPROACH = { beats: 1.5, wider: 1.25 };
const GOLD = new Color("#ffcf5a");
const WHITE = new Color("#fff6e0");

type Cue = {
  beat: number;
  voice: Voice;
  midi: number;
  length: number;
  velocity: number;
};

/** Everything the backing plays, in order: the count-in, the melody, the bass. */
const cuesOf = (chart: Chart): Cue[] => {
  const bpb = chart.beatsPerBar;
  const clicks: Cue[] = Array.from({ length: COUNT_IN_BARS * bpb }, (_, i) => ({
    beat: -COUNT_IN_BARS * bpb + i,
    voice: i % bpb === 0 ? "accent" : "click",
    midi: 0,
    length: 0.05,
    velocity: 1,
  }));
  return [
    ...clicks,
    ...chart.melody.map((t) => ({ ...t, voice: "melody" as Voice })),
    ...chart.bass.map((t) => ({ ...t, voice: "bass" as Voice })),
  ].sort((a, b) => a.beat - b.beat);
};

const player = {
  cues: [] as Cue[],
  next: 0,
  /** Notes sounding or due (so a stop or a pause can cut them). */
  voices: [] as ToneHandle[],
};

/** Cuts every backing note now, and rewinds to what is still to come. */
const cutBacking = (now: number) => {
  player.voices.forEach((v) => v.cut(now));
  player.voices = [];
  const s = drums.session;
  if (!s) return;
  const i = player.cues.findIndex((c) => c.beat > s.beat - 1e-6);
  player.next = i < 0 ? player.cues.length : i;
};

/** Each song's best stars this visit (Play only). */
const BEST_KEY = "drums.best";
export const bestStars = (): Record<string, number> => {
  try {
    return JSON.parse(
      window.sessionStorage.getItem(BEST_KEY) ?? "{}",
    ) as Record<string, number>;
  } catch {
    return {};
  }
};
const saveBest = (id: string, stars: number) => {
  try {
    const best = bestStars();
    if ((best[id] ?? 0) >= stars) return;
    best[id] = stars;
    window.sessionStorage.setItem(BEST_KEY, JSON.stringify(best));
  } catch {
    // private mode: not remembered
  }
};

/** The bottom progress line (set by the page UI). */
export const progressLine: { el: HTMLElement | null } = { el: null };

/** Starts a song (from a tap: it also starts the sound). */
export const startSong = (id: string, mode: Mode) => {
  const chart = chartById(id);
  sound.unlock();
  const a = sound.audio();
  if (!chart || !a) return;
  drums.session = new Session(
    chart,
    mode,
    drums.slow ? SLOW : 1,
    a.ctx.currentTime + 0.1,
  );
  player.cues = cuesOf(chart);
  player.next = 0;
  drums.songCard = false;
  drums.finish = null;
  drums.changed();
};

export const stopSong = () => {
  const a = sound.audio();
  cutBacking(a?.ctx.currentTime ?? 0);
  drums.session = null;
  drums.changed();
};

/** The next song or beat in the list after `id`. */
export const nextSongId = (id: string) => {
  const i = CHARTS.findIndex((c) => c.id === id);
  return CHARTS[(i + 1) % CHARTS.length].id;
};

// ---------------------------------------------------------------- looks

const glowTexture = () => {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d");
  if (g) {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, "rgba(255,255,255,1)");
    r.addColorStop(0.3, "rgba(255,240,200,0.8)");
    r.addColorStop(1, "rgba(255,200,100,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
};

const ringMaterial = (opacity: number) =>
  new MeshBasicMaterial({
    color: GOLD,
    transparent: true,
    opacity,
    blending: AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    side: 2,
  });

const zUp = new Vector3(0, 0, 1);
const q = new Quaternion();

/** Lays a ring flat on a head, `lift` above it, `radius` wide. */
const onHead = (
  m: Mesh | Sprite | Group,
  piece: PieceId,
  radius: number,
  lift = 0.008,
) => {
  const h = headOf(piece);
  if (!h) return false;
  m.position.copy(h.center).addScaledVector(h.normal, lift);
  m.quaternion.copy(q.setFromUnitVectors(zUp, h.normal));
  m.scale.setScalar(radius);
  return true;
};

type Burst = { piece: PieceId; at: number; perfect: boolean };

const CONFETTI = 260;

export const SongPlayer = () => {
  const ring = useMemo(() => {
    const geo = new RingGeometry(0.9, 1, 72);
    const target = new Mesh(geo, ringMaterial(0.9));
    const glow = new Mesh(new RingGeometry(0.8, 1.06, 72), ringMaterial(0.25));
    const preview = new Mesh(geo, ringMaterial(0.22));
    [target, glow, preview].forEach((m) => {
      /* eslint-disable no-param-reassign */
      m.renderOrder = 40;
      m.visible = false;
      m.frustumCulled = false;
      /* eslint-enable no-param-reassign */
    });
    return { target, glow, preview };
  }, []);

  // Bursts: a gold ring and flash (perfect) or a few sparkles (good).
  const bursts = useMemo(() => {
    const map = glowTexture();
    return Array.from({ length: 6 }, () => {
      const ringMesh = new Mesh(new RingGeometry(0.85, 1, 64), ringMaterial(0));
      ringMesh.renderOrder = 41;
      const flash = new Sprite(
        new SpriteMaterial({
          map,
          blending: AdditiveBlending,
          transparent: true,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
          opacity: 0,
        }),
      );
      flash.renderOrder = 42;
      const sparks = Array.from({ length: 5 }, () => {
        const s = new Sprite(
          new SpriteMaterial({
            map,
            blending: AdditiveBlending,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
            opacity: 0,
            color: WHITE,
          }),
        );
        s.renderOrder = 42;
        return s;
      });
      [ringMesh, flash, ...sparks].forEach((o) => {
        // eslint-disable-next-line no-param-reassign
        o.visible = false;
      });
      return { ring: ringMesh, flash, sparks, burst: null as Burst | null };
    });
  }, []);
  const nextBurst = useRef(0);

  // Confetti over the kit at the end of a song.
  const confetti = useMemo(() => {
    const geo = new BufferGeometry();
    const pos = new Float32Array(CONFETTI * 3);
    const col = new Float32Array(CONFETTI * 3);
    const palette = [
      "#ffcf5a",
      "#ff6b8a",
      "#6bd5ff",
      "#b48cff",
      "#7dffb0",
      "#ffffff",
    ].map((c) => new Color(c));
    for (let i = 0; i < CONFETTI; i += 1) {
      const c = palette[i % palette.length];
      col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute("position", new BufferAttribute(pos, 3));
    geo.setAttribute("color", new BufferAttribute(col, 3));
    const pts = new Points(
      geo,
      new PointsMaterial({
        size: 0.022,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    pts.frustumCulled = false;
    pts.visible = false;
    const seeds = Array.from({ length: CONFETTI }, () => ({
      // Over the kit and the room beyond it (never right at the camera).
      x: (Math.random() - 0.5) * 2.4,
      z: -0.5 + Math.random() * 1.6,
      y: 2.2 + Math.random() * 0.9,
      vx: (Math.random() - 0.5) * 0.4,
      vz: (Math.random() - 0.5) * 0.4,
      fall: 0.55 + Math.random() * 0.45,
      sway: Math.random() * Math.PI * 2,
    }));
    return { pts, pos, seeds };
  }, []);

  useEffect(() => {
    drums.songHit = (piece) => {
      const s = drums.session;
      const a = sound.audio();
      if (s && a) s.hit(piece, a.ctx.currentTime);
    };
    // Hiding the page pauses the song and its backing; coming back goes on
    // after a one-bar count-in.
    const onVisible = () => {
      const s = drums.session;
      const a = sound.audio();
      if (!s || !a) return;
      const t = a.ctx.currentTime;
      if (document.hidden) {
        s.pause(t);
        cutBacking(t);
      } else if (s.paused) {
        const bpb = s.chart.beatsPerBar;
        s.resume(t, bpb * s.secondsPerBeat);
        for (let i = 0; i < bpb; i += 1)
          player.voices.push(
            playTone(
              a.ctx,
              a.out,
              i === 0 ? "accent" : "click",
              0,
              t + i * s.secondsPerBeat,
              0.05,
              1,
            ),
          );
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      drums.songHit = null;
    };
  }, []);

  useFrame(() => {
    const s = drums.session;
    const a = sound.audio();
    const nowMs = performance.now();

    if (s && a) {
      const t = a.ctx.currentTime;
      s.update(t);
      // The backing: everything due soon (Learn: not past the waiting note).
      const horizon = Math.min(s.beat + LOOKAHEAD / s.secondsPerBeat, s.limit);
      while (
        player.next < player.cues.length &&
        player.cues[player.next].beat < horizon
      ) {
        const c = player.cues[player.next];
        player.voices.push(
          playTone(
            a.ctx,
            a.out,
            c.voice,
            c.midi,
            s.timeOf(c.beat, t),
            c.length * s.secondsPerBeat,
            c.velocity,
          ),
        );
        player.next += 1;
      }
      player.voices = player.voices.filter((v) => v.end > t);
      // How far through the song.
      if (progressLine.el) {
        const into = COUNT_IN_BARS * s.chart.beatsPerBar;
        const k = (s.beat + into) / (s.chart.bars * s.chart.beatsPerBar + into);
        progressLine.el.style.transform = `scaleX(${Math.min(1, Math.max(0, k)).toFixed(4)})`;
      }
      // Answers to the hits.
      s.events.forEach((e) => {
        if (s.mode !== "play" || e.result === "miss") return;
        const b = bursts[nextBurst.current];
        nextBurst.current = (nextBurst.current + 1) % bursts.length;
        b.burst = {
          piece: e.piece,
          at: nowMs,
          perfect: e.result === "perfect",
        };
      });
      s.events.length = 0;
      // The end: stars, a big hit, confetti.
      if (s.done) {
        drums.finish = {
          stars: s.stars,
          at: nowMs,
          id: s.chart.id,
          mode: s.mode,
          results: s.results,
          offsets: s.offsets,
        };
        if (s.mode === "play") saveBest(s.chart.id, s.stars);
        drums.session = null;
        sound.play("crash", 0.95);
        sound.play("kick", 1);
        drums.changed();
      }
    }

    // The target rings.
    const run = drums.session;
    const { notes } = run?.chart ?? { notes: [] };
    const cur = run ? notes[run.next] : null;
    ring.target.visible = false;
    ring.glow.visible = false;
    ring.preview.visible = false;
    if (run && cur) {
      const h = headOf(cur.piece);
      if (h) {
        const ahead = cur.beat - run.beat; // beats to go
        const k = Math.min(1, Math.max(0, ahead / APPROACH.beats));
        const pulse = run.waiting ? 0.5 + 0.5 * Math.sin(nowMs / 160) : 0;
        const r =
          h.radius * (1 + (APPROACH.wider - 1) * easeOut(k) + 0.04 * pulse);
        ring.target.visible =
          onHead(ring.target, cur.piece, r) && ahead < APPROACH.beats * 1.6;
        ring.glow.visible =
          onHead(ring.glow, cur.piece, r) && ring.target.visible;
        (ring.target.material as MeshBasicMaterial).opacity =
          0.55 + 0.4 * (1 - k);
        (ring.glow.material as MeshBasicMaterial).opacity =
          0.18 + 0.2 * (1 - k) + 0.15 * pulse;
      }
      const after = notes[run.next + 1];
      if (after) {
        const ha = headOf(after.piece);
        if (ha)
          ring.preview.visible = onHead(
            ring.preview,
            after.piece,
            ha.radius * 1.12,
            0.006,
          );
      }
    }

    // Bursts.
    /* eslint-disable no-param-reassign */
    bursts.forEach((b) => {
      const e = b.burst ? (nowMs - b.burst.at) / 1000 : 9;
      const on = b.burst !== null && e < 0.45;
      b.ring.visible = on && !!b.burst?.perfect;
      b.flash.visible = on && !!b.burst?.perfect;
      b.sparks.forEach((sp) => {
        sp.visible = on && !b.burst?.perfect;
      });
      if (!on || !b.burst) return;
      const h = headOf(b.burst.piece);
      if (!h) return;
      const k = easeOut(e / 0.45);
      if (b.burst.perfect) {
        onHead(b.ring, b.burst.piece, h.radius * (1 + 0.6 * k), 0.012);
        (b.ring.material as MeshBasicMaterial).opacity = 0.95 * (1 - k);
        b.flash.position.copy(h.center).addScaledVector(h.normal, 0.03);
        b.flash.scale.setScalar(h.radius * (1.2 + 1.2 * k));
        b.flash.material.opacity = 0.8 * (1 - k);
      } else {
        b.sparks.forEach((sp, i) => {
          const ang = (i / b.sparks.length) * Math.PI * 2 + b.burst!.at;
          sp.position
            .copy(h.center)
            .addScaledVector(h.normal, 0.02 + 0.08 * k)
            .add(
              new Vector3(Math.cos(ang), 0, Math.sin(ang)).multiplyScalar(
                h.radius * (0.5 + 0.6 * k),
              ),
            );
          sp.scale.setScalar(0.035 * (1 - 0.5 * k));
          sp.material.opacity = 0.9 * (1 - k);
        });
      }
    });

    /* eslint-enable no-param-reassign */

    // Confetti after a song.
    const f = drums.finish;
    const ce = f ? (nowMs - f.at) / 1000 : 99;
    confetti.pts.visible = ce < 4.5;
    if (confetti.pts.visible) {
      const fade = 1 - easeOut((ce - 3.2) / 1.3);
      (confetti.pts.material as PointsMaterial).opacity = ce < 3.2 ? 1 : fade;
      confetti.seeds.forEach((p, i) => {
        const y = p.y - p.fall * ce;
        confetti.pos[i * 3] =
          p.x + p.vx * ce + 0.06 * Math.sin(ce * 3 + p.sway);
        confetti.pos[i * 3 + 1] = Math.max(0.01, y);
        confetti.pos[i * 3 + 2] =
          p.z + p.vz * ce + 0.06 * Math.cos(ce * 2.6 + p.sway);
      });
      confetti.pts.geometry.attributes.position.needsUpdate = true;
    }
  });

  return (
    <>
      <primitive object={ring.target} />
      <primitive object={ring.glow} />
      <primitive object={ring.preview} />
      {bursts
        .flatMap((b) => [b.ring, b.flash, ...b.sparks])
        .map((o) => (
          <primitive key={o.uuid} object={o} />
        ))}
      <primitive object={confetti.pts} />
    </>
  );
};
