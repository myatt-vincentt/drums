// A soft cool glow on each piece a hand aims at, so you always see what a
// stroke will play. It fades in as a hand moves over a piece and out as it
// leaves (strict ease-out), and brightens for a moment on a hit.
import { useMemo } from "react";
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

import { STICK_ORDER, type StickPiece } from "./aim";
import { ghosts } from "./GhostHands";
import { drums, headOf } from "./state";

/** Fade in and out (s). */
const FADE_IN = 0.12;
const FADE_OUT = 0.25;
/** How bright at rest, and the extra flash on a hit (fading over `FLASH` s). */
const LEVEL = 0.55;
const FLASH = 0.25;

/** A soft cool ring: bright at the head's rim, fading in and out from it. */
const glowTexture = () => {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  if (g) {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, "rgba(170,205,255,0.10)");
    r.addColorStop(0.62, "rgba(170,205,255,0.16)");
    r.addColorStop(0.84, "rgba(205,228,255,1)");
    r.addColorStop(1, "rgba(170,205,255,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
};

const zUp = new Vector3(0, 0, 1);
const q = new Quaternion();

export const AimGlow = () => {
  const glows = useMemo(() => {
    const map = glowTexture();
    return STICK_ORDER.map((piece) => {
      const m = new Mesh(
        new PlaneGeometry(2, 2),
        new MeshBasicMaterial({
          map,
          transparent: true,
          opacity: 0,
          blending: AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      m.renderOrder = 41;
      m.visible = false;
      return { piece, mesh: m, level: 0 };
    });
  }, []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const now = performance.now();
    glows.forEach((g) => {
      /* eslint-disable no-param-reassign */
      const aimed =
        drums.handsOn &&
        (["left", "right"] as const).some(
          (s) => ghosts[s].tracked && ghosts[s].piece === g.piece,
        );
      const target = aimed ? 1 : 0;
      const rate = 3 / (aimed ? FADE_IN : FADE_OUT);
      g.level += (target - g.level) * (1 - Math.exp(-rate * dt));
      const head = headOf(g.piece as StickPiece);
      g.mesh.visible = g.level > 0.003 && head !== null;
      if (!g.mesh.visible || !head) return;
      g.mesh.position.copy(head.center).addScaledVector(head.normal, 0.006);
      g.mesh.quaternion.copy(q.setFromUnitVectors(zUp, head.normal));
      g.mesh.scale.setScalar(head.radius * 1.12);
      const since = (now - drums.hitAt[g.piece]) / 1000;
      const flash = since < FLASH ? 1 - since / FLASH : 0;
      (g.mesh.material as MeshBasicMaterial).opacity =
        g.level * (LEVEL + 0.45 * flash * flash);
      /* eslint-enable no-param-reassign */
    });
  });

  return (
    <>
      {glows.map((g) => (
        <primitive key={g.piece} object={g.mesh} />
      ))}
    </>
  );
};
