// A soft warm glow on the snare after the first steps card closes: it fades
// in, breathes gently and fades away on the first hit. Once only.
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three";

import { drums, headOf } from "./state";

/** Fade in and out over these (s), strict ease-out; one breath this long (s). */
const FADE_IN = 0.8;
const FADE_OUT = 0.5;
const BREATH = 2.2;

/** A soft gold ring: bright at the head's rim, fading in and out from it. */
const glowTexture = () => {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  if (g) {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, "rgba(255,190,70,0)");
    r.addColorStop(0.6, "rgba(255,190,70,0.12)");
    r.addColorStop(0.82, "rgba(255,205,100,1)");
    r.addColorStop(1, "rgba(255,190,70,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
};

const zUp = new Vector3(0, 0, 1);
const q = new Quaternion();
const ease = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

export const Invite = () => {
  const mesh = useMemo(() => {
    const m = new Mesh(
      new PlaneGeometry(2, 2),
      new MeshBasicMaterial({
        map: glowTexture(),
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    m.renderOrder = 40;
    m.visible = false;
    return m;
  }, []);
  const state = useRef({ level: 0, from: 0, at: 0, on: false });

  useFrame(() => {
    const s = state.current;
    const now = performance.now() / 1000;
    if (drums.invite !== s.on) {
      s.on = drums.invite;
      s.from = s.level;
      s.at = now;
    }
    const k = ease((now - s.at) / (s.on ? FADE_IN : FADE_OUT));
    s.level = s.from + ((s.on ? 1 : 0) - s.from) * k;
    const head = headOf("snare");
    mesh.visible = s.level > 0.002 && head !== null;
    if (!mesh.visible || !head) return;
    mesh.position.copy(head.center).addScaledVector(head.normal, 0.006);
    mesh.quaternion.copy(q.setFromUnitVectors(zUp, head.normal));
    mesh.scale.setScalar(head.radius * 1.15);
    const breath = 0.5 - 0.5 * Math.cos((2 * Math.PI * (now - s.at)) / BREATH);
    (mesh.material as MeshBasicMaterial).opacity =
      s.level * (0.45 + 0.4 * breath);
  });

  return <primitive object={mesh} />;
};
