// Playing with a mouse or a finger, no hands needed: tap or click a drum or
// cymbal and the nearer ghost stick swings onto it; tap anywhere else (or
// press the space bar) for the kick. Holding the button (or finger) down on
// the hi-hat closes it, the same as resting a stick on it; letting go opens
// it. Works in every view.
import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { Plane, Raycaster, Vector2, Vector3, type Object3D } from "three";

import { sound } from "./audio";
import { swingAt } from "./GhostHands";
import { isHardware, PIECES, type PieceId } from "./pieces";
import { drums, hatChanged, headOf, strike } from "./state";

/** Loudness of a tap. */
const TAP_VELOCITY = 0.72;
/** A tap just beside a head (within this many radii) still hits it. */
const NEAR = 1.15;

const NODES = new Map<string, PieceId>(PIECES.map((p) => [p.node, p.id]));

/** Is this event on a control (the dock, a card, the camera, the media switcher…)? */
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

const plane = new Plane();
const onPlane = new Vector3();

export const PointerInput = () => {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const ray = new Raycaster();
    const ndc = new Vector2();
    const canvas = gl.domElement;
    let held = false;

    const setNdc = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      ndc.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -(((e.clientY - r.top) / r.height) * 2 - 1),
      );
      ray.setFromCamera(ndc, camera);
    };

    /** The piece under the pointer and the point on its head. */
    const pick = (): { id: PieceId; point: Vector3 } | null => {
      let best: { id: PieceId; point: Vector3; q: number } | null = null;
      if (drums.root) {
        const hit = ray.intersectObject(drums.root, true)[0];
        const id = hit ? pieceOf(hit.object) : null;
        const h = id ? headOf(id) : null;
        if (id && h) {
          // Where on the head (in kit space): the ray's crossing of the
          // head's plane, or the head's middle when that is far off (a head
          // seen edge-on or from behind).
          plane.setFromNormalAndCoplanarPoint(h.normal, h.center);
          const p = ray.ray.intersectPlane(plane, onPlane);
          const ok = p && p.distanceTo(h.center) < h.radius * 1.2;
          return { id, point: (ok ? p : h.center).clone() };
        }
      }
      // Thin cymbal edges and near misses: the nearest head's disc.
      drums.heads.forEach((h) => {
        if (h.id === "kick") return;
        plane.setFromNormalAndCoplanarPoint(h.normal, h.center);
        const p = ray.ray.intersectPlane(plane, onPlane);
        if (!p) return;
        const q = p.distanceTo(h.center) / h.radius;
        if (q <= NEAR && (!best || q < best.q))
          best = { id: h.id, point: p.clone(), q };
      });
      const b = best as { id: PieceId; point: Vector3 } | null;
      return b ? { id: b.id, point: b.point } : null;
    };

    const onDown = (e: PointerEvent) => {
      if (onControl(e)) return;
      sound.unlock();
      setNdc(e);
      const found = pick();
      const id = found?.id ?? "kick";
      strike(
        id,
        TAP_VELOCITY + (Math.random() - 0.5) * 0.08,
        "pointer",
        found?.point ?? null,
      );
      if (found && id !== "kick") swingAt(id, found.point);
      held = true;
      const onHat = id === "hihat" && found;
      Object.assign(drums.pointer, {
        present: !!onHat,
        x: onHat ? found.point.x : 0,
        y: onHat ? found.point.y : 0,
        speed: 0,
      });
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
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [camera, gl]);

  return null;
};
