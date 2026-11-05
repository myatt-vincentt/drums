// Your camera, small, in the top-right corner: the live picture (exactly
// what the rest of the app gets from the session: mirrored on a webcam,
// cover-fitted, never stretched) clipped to a rounded panel with a glass
// edge and a soft shadow. Picture, edge and shadow are one quad drawn from
// one rect (layout.ts), so they can never drift apart at any size.
//
// Over the picture: where each piece is played from (the same grid the
// sticks use, over your learnt reach: the hi-hat, the tom and the crash
// along the top, the snare and the floor tom along the bottom), named,
// the one under each hand lit and the one just hit flashing; and each
// tracked hand's points and bones. Tap it to tuck it
// away (it shrinks into the corner, leaving a small camera button); tap
// that to bring it back. It is hidden while there is no camera picture.
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  CanvasTexture,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  Vector4,
  type Mesh,
} from "three";
import { useXRCameraTexture } from "@vincentt-xr/sdk/low-level";

import { AIM, GRID, SPOTS } from "./aim";
import { ghosts, reachBox } from "./GhostHands";
import { FRAME_RADIUS, frameRect } from "./layout";
import { drums } from "./state";

/** Room around the panel for its shadow (CSS px). */
const MARGIN = 28;
/** Tuck away / bring back (s). */
const TUCK = 0.35;
/** Each piece's name on the camera, in SPOTS order. */
const NAMES: Record<string, string> = {
  hihat: "Hi-hat",
  tom1: "Tom",
  crash: "Crash",
  snare: "Snare",
  tom2: "Floor tom",
};
/** A name's size on the camera (CSS px). */
const LABEL = { w: 66, h: 15 };
/** A hit's flash fades over this long (s). */
const FLASH = 0.35;

/** The pieces' names, one row each, for the shader. */
const labelAtlas = () => {
  const c = document.createElement("canvas");
  const rowH = 48;
  c.width = 220;
  c.height = rowH * SPOTS.length;
  const g = c.getContext("2d");
  if (g) {
    g.font = "600 30px system-ui, -apple-system, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    SPOTS.forEach((sp, i) => {
      // A dark pill behind each name, so it reads on any picture.
      const text = NAMES[sp.id];
      const tw = Math.min(c.width - 4, g.measureText(text).width + 28);
      const y = rowH * i + 4;
      const ph = rowH - 8;
      g.fillStyle = "rgba(10,14,20,0.62)";
      g.beginPath();
      g.roundRect((c.width - tw) / 2, y, tw, ph, ph / 2);
      g.fill();
      g.fillStyle = "#ffffff";
      g.fillText(text, c.width / 2, rowH * (i + 0.5));
    });
  }
  return new CanvasTexture(c);
};

const vert = /* glsl */ `
  uniform vec4 rect;   // panel: left, top, width, height (CSS px)
  uniform vec2 screen; // CSS px
  uniform float margin;
  varying vec2 vPx;    // CSS px from the panel's top-left
  void main() {
    vec2 size = rect.zw + 2.0 * margin;
    vec2 local = vec2(uv.x, 1.0 - uv.y) * size - margin;
    vPx = local;
    vec2 px = rect.xy + local;
    gl_Position = vec4(px.x / screen.x * 2.0 - 1.0, 1.0 - px.y / screen.y * 2.0, 0.0, 1.0);
  }
`;

const frag = /* glsl */ `
  uniform sampler2D cam;
  uniform float camLinear;
  uniform vec4 rect;
  uniform float radius;
  uniform float screenAspect;
  uniform float opacity;
  uniform vec2 shown;      // each hand shown, 0..1
  uniform vec2 handL[21];  // each hand's points on the picture (u, v down)
  uniform vec2 handR[21];
  uniform float guides;      // the pieces' map shown, 0..1
  uniform vec4 reach;        // your reach on the picture: u0, u1, v0, v1
  uniform vec4 grid;         // the kit's grid: row split, top thirds, bottom half
  uniform float over;        // how far past the reach the kit goes
  uniform float lit[5];      // each piece under a hand, 0..1
  uniform float flash[5];    // each piece just hit, 0..1
  uniform vec2 labelAt[5];   // each name's place on the picture (u, v down)
  uniform vec2 labelSize;    // CSS px
  uniform sampler2D labels;
  varying vec2 vPx;

  // The hand's bones: pairs of point indexes.
  const int BONES = 21;
  int boneA(int i) {
    if (i < 4) return i; if (i == 4) return 0; if (i < 8) return i;
    if (i == 8) return 5; if (i < 12) return i - 3; if (i == 12) return 9;
    if (i < 16) return i - 3; if (i == 16) return 13; if (i < 20) return i - 3;
    return 0;
  }
  int boneB(int i) {
    if (i < 4) return i + 1; if (i == 4) return 5; if (i < 8) return i + 1;
    if (i == 8) return 9; if (i < 12) return i - 2; if (i == 12) return 13;
    if (i < 16) return i - 2; if (i == 16) return 17; if (i < 20) return i - 2;
    return 17;
  }
  float segDist(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    return length(p - a - ab * t);
  }

  vec3 toSrgb(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
  float roundedBox(vec2 p, vec2 halfSize, float r) {
    vec2 q = abs(p) - (halfSize - r);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  // Panel uv (0..1, y up) → camera picture uv (cover fit), and back. A crop
  // from the top and bottom sits a little high: faces and raised hands are
  // in the upper part of a selfie.
  float cropMid(float k) { return min(0.5 + 0.12, 1.0 - 0.5 * k); }
  vec2 toCam(vec2 p, float pa) {
    if (pa > screenAspect) {
      float k = screenAspect / pa;
      return vec2(p.x, cropMid(k) + (p.y - 0.5) * k);
    }
    return vec2(0.5 + (p.x - 0.5) * pa / screenAspect, p.y);
  }
  vec2 toPanel(vec2 c, float pa) {
    if (pa > screenAspect) {
      float k = screenAspect / pa;
      return vec2(c.x, 0.5 + (c.y - cropMid(k)) / k);
    }
    return vec2(0.5 + (c.x - 0.5) * screenAspect / pa, c.y);
  }

  // The piece whose area of the grid holds a place on the kit (aim.ts).
  int pieceAt(vec2 k) {
    if (k.y < grid.x) return k.x < grid.y ? 0 : (k.x < grid.z ? 1 : 2);
    return k.x < grid.w ? 3 : 4;
  }
  float pick(float a[5], int id) {
    float v = 0.0;
    for (int i = 0; i < 5; i++) if (i == id) v = a[i];
    return v;
  }

  void main() {
    vec2 size = rect.zw;
    vec2 hs = size * 0.5;
    float r = min(radius, min(hs.x, hs.y));
    float d = roundedBox(vPx - hs, hs, r);

    // The soft drop shadow outside the panel (0 8px 24px, 22 %).
    if (d > 0.0) {
      float ds = roundedBox(vPx - hs - vec2(0.0, 8.0), hs, r);
      float a = 0.22 * (1.0 - smoothstep(-6.0, 22.0, ds));
      a *= smoothstep(0.0, 1.0, d) * opacity;
      if (a < 0.004) discard;
      gl_FragColor = vec4(0.0, 0.0, 0.0, a);
      return;
    }

    float pa = size.x / size.y;
    vec2 uv = vec2(vPx.x / size.x, 1.0 - vPx.y / size.y);
    vec3 c = texture2D(cam, toCam(uv, pa)).rgb;
    if (camLinear > 0.5) c = toSrgb(c);

    // Where each piece is played from: faint areas, the one under a hand
    // lit, the one just hit flashing, thin borders, and their names.
    if (guides > 0.01) {
      vec2 cuv = toCam(uv, pa);
      vec2 pic = vec2(cuv.x, 1.0 - cuv.y);
      vec2 k = clamp(
        (pic - reach.xz) / max(reach.yw - reach.xz, vec2(1e-4)),
        vec2(-over), vec2(1.0 + over));
      int id = pieceAt(k);
      // Thin lines between the areas (1 px whatever the reach).
      vec2 fw = max(fwidth(k), vec2(1e-5));
      float line = 1.0 - smoothstep(0.5, 1.5, abs(k.y - grid.x) / fw.y);
      if (k.y < grid.x) {
        line = max(line, 1.0 - smoothstep(0.5, 1.5, abs(k.x - grid.y) / fw.x));
        line = max(line, 1.0 - smoothstep(0.5, 1.5, abs(k.x - grid.z) / fw.x));
      } else
        line = max(line, 1.0 - smoothstep(0.5, 1.5, abs(k.x - grid.w) / fw.x));
      bool cymbal = id == 0 || id == 2;
      vec3 tint = cymbal ? vec3(1.0, 0.82, 0.45) : vec3(0.78, 0.9, 1.0);
      float a = 0.05 + 0.2 * pick(lit, id) + 0.4 * pick(flash, id);
      c = mix(c, tint, a * guides);
      c = mix(c, vec3(1.0), line * 0.55 * guides);
      for (int i = 0; i < 5; i++) {
        vec2 lp = toPanel(vec2(labelAt[i].x, 1.0 - labelAt[i].y), pa);
        vec2 q = (vPx - vec2(lp.x, 1.0 - lp.y) * size) / labelSize + 0.5;
        if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0) {
          vec4 t = texture2D(labels, vec2(q.x, 1.0 - (float(i) + q.y) / 5.0));
          c = mix(c, t.rgb, t.a * guides * 0.95);
        }
      }
    }

    // Each tracked hand: its bones and points.
    for (int k = 0; k < 2; k++) {
      float s = k == 0 ? shown.x : shown.y;
      if (s < 0.02) continue;
      float bone = 1e9;
      float joint = 1e9;
      for (int i = 0; i < BONES; i++) {
        vec2 a = k == 0 ? handL[boneA(i)] : handR[boneA(i)];
        vec2 b = k == 0 ? handL[boneB(i)] : handR[boneB(i)];
        vec2 pa2 = toPanel(vec2(a.x, 1.0 - a.y), pa);
        vec2 pb2 = toPanel(vec2(b.x, 1.0 - b.y), pa);
        bone = min(bone, segDist(vPx, vec2(pa2.x, 1.0 - pa2.y) * size, vec2(pb2.x, 1.0 - pb2.y) * size));
      }
      for (int i = 0; i < 21; i++) {
        vec2 a = k == 0 ? handL[i] : handR[i];
        vec2 pp = toPanel(vec2(a.x, 1.0 - a.y), pa);
        joint = min(joint, length(vPx - vec2(pp.x, 1.0 - pp.y) * size));
      }
      float lineA = (1.0 - smoothstep(0.6, 1.4, bone)) * 0.7;
      float dotA = 1.0 - smoothstep(1.6, 2.5, joint);
      c = mix(c, vec3(0.80, 0.90, 1.0), lineA * s);
      c = mix(c, vec3(1.0), dotA * s);
    }

    // Glass edge: a 1px light line, and a soft highlight along the top.
    float edge = 1.0 - smoothstep(0.0, 1.0, abs(d + 0.5));
    c = mix(c, vec3(0.92, 0.965, 0.99), edge * 0.35);
    float top = (1.0 - smoothstep(0.0, 2.0, vPx.y)) * (1.0 - smoothstep(-3.0, 0.0, d + 2.0));
    c = mix(c, vec3(1.0), top * 0.22);
    float inside = 1.0 - smoothstep(-0.5, 0.5, d);
    gl_FragColor = vec4(c, inside * opacity);
  }
`;

const ease = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

/** How shown the corner camera is (0 tucked away … 1 shown). */
const frameShown = { k: 1 };

export const CameraFrame = () => {
  const texture = useXRCameraTexture();
  const mesh = useRef<Mesh>(null);
  const tuck = useRef({ hidden: drums.camHidden, from: 1, to: 1, at: -10 });
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          cam: { value: null },
          camLinear: { value: 0 },
          rect: { value: [16, 16, 120, 160] },
          radius: { value: FRAME_RADIUS },
          margin: { value: MARGIN },
          screen: { value: [1, 1] },
          screenAspect: { value: 1 },
          opacity: { value: 1 },
          shown: { value: [0, 0] },
          handL: { value: Array.from({ length: 21 }, () => new Vector2()) },
          handR: { value: Array.from({ length: 21 }, () => new Vector2()) },
          guides: { value: 0 },
          reach: { value: new Vector4(0.2, 0.8, 0.3, 0.75) },
          grid: {
            value: new Vector4(GRID.row, GRID.top[0], GRID.top[1], GRID.bottom),
          },
          over: { value: AIM.over },
          lit: { value: [0, 0, 0, 0, 0] },
          flash: { value: [0, 0, 0, 0, 0] },
          labelAt: { value: SPOTS.map(() => new Vector2()) },
          labelSize: { value: new Vector2(LABEL.w, LABEL.h) },
          labels: { value: labelAtlas() },
        },
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );

  useFrame(({ size }) => {
    const m = mesh.current;
    const tk = tuck.current;
    const now = performance.now() / 1000;
    if (tk.hidden !== drums.camHidden) {
      tk.hidden = drums.camHidden;
      tk.from = frameShown.k;
      tk.to = tk.hidden ? 0 : 1;
      tk.at = now;
    }
    frameShown.k = tk.from + (tk.to - tk.from) * ease((now - tk.at) / TUCK);
    const { k } = frameShown;
    if (m) m.visible = !!texture && k > 0.01;
    if (!texture) return;
    const u = material.uniforms;
    const r = frameRect(size.width, size.height);
    // Tucking away shrinks the panel into its top-right corner.
    const s = 0.2 + 0.8 * k;
    const w = r.width * s;
    const h = r.height * s;
    u.rect.value = [r.left + r.width - w, r.top, w, h];
    u.opacity.value = k;
    u.screen.value = [size.width, size.height];
    u.screenAspect.value = size.width / Math.max(1, size.height);
    u.cam.value = texture;
    u.camLinear.value = texture.colorSpace === SRGBColorSpace ? 1 : 0;
    u.shown.value = [ghosts.left.shown, ghosts.right.shown];
    (["left", "right"] as const).forEach((side) => {
      const g = ghosts[side];
      const pts = u[side === "left" ? "handL" : "handR"].value as Vector2[];
      pts.forEach((p, i) => p.set(g.points[i * 2], g.points[i * 2 + 1]));
    });
    // The pieces' map: over your reach, each named at its middle, lit under
    // a hand and flashing when hit.
    const b = reachBox;
    (u.reach.value as Vector4).set(b.u0, b.u1, b.v0, b.v1);
    const nowMs = performance.now();
    const lit = u.lit.value as number[];
    const flash = u.flash.value as number[];
    SPOTS.forEach((sp, i) => {
      lit[i] = 0;
      flash[i] = 0;
      (["left", "right"] as const).forEach((side) => {
        const g = ghosts[side];
        if (g.tracked && g.piece === sp.id) lit[i] = Math.max(lit[i], g.shown);
        const e = (nowMs - g.hitAt) / 1000;
        if (g.hitPiece === sp.id && e < FLASH)
          flash[i] = Math.max(flash[i], 1 - e / FLASH);
      });
      // The name sits on the piece's spot, kept inside the picture.
      const lu = b.u0 + sp.x * (b.u1 - b.u0);
      const lv = b.v0 + sp.y * (b.v1 - b.v0);
      (u.labelAt.value as Vector2[])[i].set(
        Math.min(0.92, Math.max(0.08, lu)),
        Math.min(0.94, Math.max(0.05, lv)),
      );
    });
    // The map shows while hands play.
    const on = drums.handsOn && drums.started ? 1 : 0;
    u.guides.value += (on - u.guides.value) * 0.1;
  });

  return (
    <mesh
      ref={mesh}
      material={material}
      renderOrder={1500}
      frustumCulled={false}
      visible={false}
    >
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
};
