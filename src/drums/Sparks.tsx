// A small soft flash where a stick lands on a hard hit: white-gold, brief.
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  CanvasTexture,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
} from "three";

import { easeOut } from "./fx";
import { drums, headOf } from "./state";

/** Only hits at least this loud flash. */
const FROM = 0.55;
/** How long a flash lasts (s), its size (m) and how many at once. */
const LIFE = 0.14;
const SIZE = { base: 0.05, loud: 0.07 };
const POOL = 4;

const glowTexture = () => {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d");
  if (g) {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, "rgba(255,255,255,1)");
    r.addColorStop(0.25, "rgba(255,236,190,0.9)");
    r.addColorStop(0.6, "rgba(255,205,120,0.25)");
    r.addColorStop(1, "rgba(255,190,90,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
};

export const Sparks = () => {
  const pool = useMemo(() => {
    const map = glowTexture();
    return Array.from({ length: POOL }, () => {
      const s = new Sprite(
        new SpriteMaterial({
          map,
          blending: AdditiveBlending,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
          opacity: 0,
        }),
      );
      s.visible = false;
      s.renderOrder = 30;
      return { s, at: -10, size: 0 };
    });
  }, []);
  const seen = useRef(0);
  const next = useRef(0);

  useFrame(() => {
    const now = performance.now() / 1000;
    drums.events.forEach((e) => {
      if (e.seq <= seen.current) return;
      seen.current = e.seq;
      if (e.velocity < FROM || !e.point || e.piece === "kick") return;
      const p = pool[next.current];
      next.current = (next.current + 1) % POOL;
      const h = headOf(e.piece);
      p.s.position.copy(e.point);
      if (h) p.s.position.addScaledVector(h.normal, 0.012);
      p.at = e.at;
      p.size = SIZE.base + (SIZE.loud * (e.velocity - FROM)) / (1 - FROM);
    });
    pool.forEach((p) => {
      const t = (now - p.at) / LIFE;
      /* eslint-disable no-param-reassign */
      p.s.visible = t >= 0 && t < 1;
      if (!p.s.visible) return;
      p.s.material.opacity = 1 - easeOut(t);
      p.s.scale.setScalar(p.size * (0.7 + 0.5 * easeOut(t)));
      /* eslint-enable no-param-reassign */
    });
  });

  return (
    <>
      {pool.map((p) => (
        <primitive key={p.s.uuid} object={p.s} />
      ))}
    </>
  );
};
