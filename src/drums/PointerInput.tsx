// Playing with a mouse or a finger, no hands needed: tap or click a drum or
// cymbal to hit it, anywhere else for the kick. Holding the button (or
// finger) down on the hi-hat closes it, the same as resting a stick on it;
// letting go opens it. The space bar plays the kick too.
import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { Raycaster, Vector2, type Object3D } from "three";

import { zoneAt } from "./hits";
import { isHardware, PIECES, type PieceId } from "./pieces";
import { sound } from "./audio";
import { drums, hatChanged, strike } from "./state";

/** Loudness of a tap. */
const TAP_VELOCITY = 0.72;
/** A tap just beside a head (within this many radii) still hits it. */
const NEAR = 1.08;

const NODES = new Map<string, PieceId>(PIECES.map((p) => [p.node, p.id]));

/** Is this event on a control (a chip, the media switcher…), not the kit? */
const onControl = (e: Event) => {
  const el = e.target as HTMLElement | null;
  return !!el?.closest?.(
    "[data-hud], button, select, input, a, [role='button']",
  );
};

/** The piece a model part belongs to; null for stands and hardware. */
const pieceOf = (o: Object3D | null): PieceId | null => {
  let n: Object3D | null = o;
  while (n) {
    if (isHardware(n.name)) return null;
    const id = NODES.get(n.name);
    if (id) return id;
    n = n.parent;
  }
  return null;
};

export const PointerInput = () => {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const ray = new Raycaster();
    const ndc = new Vector2();
    const canvas = gl.domElement;
    let held = false;

    /** Client pixels → screen heights (y up, centre origin), and NDC. */
    const toScreen = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      ndc.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -(((e.clientY - r.top) / r.height) * 2 - 1),
      );
      return { x: ndc.x * 0.5 * (r.width / r.height), y: ndc.y * 0.5 };
    };

    const pick = (x: number, y: number): PieceId | null => {
      if (drums.root) {
        ray.setFromCamera(ndc, camera);
        const hit = ray.intersectObject(drums.root, true)[0];
        const id = hit ? pieceOf(hit.object) : null;
        if (id) return id;
      }
      // Thin cymbal edges and near misses: the head's ellipse on screen.
      return zoneAt(drums.zones, x, y, NEAR)?.id ?? null;
    };

    const onDown = (e: PointerEvent) => {
      if (onControl(e)) return;
      sound.unlock();
      const p = toScreen(e);
      const id = pick(p.x, p.y) ?? "kick";
      strike(id, TAP_VELOCITY + (Math.random() - 0.5) * 0.08, "pointer");
      held = true;
      Object.assign(drums.pointer, { present: true, x: p.x, y: p.y, speed: 0 });
    };
    const onMove = (e: PointerEvent) => {
      if (!held) return;
      const p = toScreen(e);
      drums.pointer.x = p.x;
      drums.pointer.y = p.y;
    };
    const onUp = () => {
      if (!held) return;
      held = false;
      drums.pointer.present = false;
      hatChanged(drums.hihat.release("pointer"));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.key !== " " || onControl(e)) return;
      e.preventDefault();
      sound.unlock();
      strike("kick", TAP_VELOCITY, "pointer");
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [camera, gl]);

  return null;
};
