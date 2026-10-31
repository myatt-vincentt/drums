// The recording studio around the kit, and its light, day and night.
//
// Day: daylight through the big window on the left wall, a soft fill from
// behind the seat and from the far wall, the kit's shadow on the rug. Night:
// the same room, dark blue at the window; the ceiling cans, the warm floor
// lamp and the purple LED strip along the bottom of the back wall light it,
// with a cool key from above. The two blend smoothly when you switch (strict
// ease-out).
//
// The kit reflects the room itself: the studio is rendered into a cube map
// (once it has loaded, and again as the light changes) and used as the
// scene's environment. A filmic tone curve (AgX) keeps highlights soft.
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import {
  AgXToneMapping,
  AmbientLight,
  Box3,
  Color,
  CubeCamera,
  DirectionalLight,
  HalfFloatType,
  PCFSoftShadowMap,
  PMREMGenerator,
  RectAreaLight,
  SpotLight,
  Vector3,
  WebGLCubeRenderTarget,
  type Light,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type Texture,
} from "three";
// eslint-disable-next-line import/extensions
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
// eslint-disable-next-line import/extensions
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import { EXPOSURE } from "./look";
import { MODELS } from "./models";
import { drums } from "./state";

useGLTF.preload(MODELS.studio);

/** Day ⇄ night takes this long (s). */
const SWITCH = 0.9;
/** The layer the room (and its lights) also sit on, for the reflection capture. */
const ROOM_LAYER = 1;
/** Shadow map size by screen (phones get a smaller one). */
const SHADOW = { desktop: 2048, phone: 1024 };

/** Glowing parts of the room: emission colour and strength, day / night. */
const GLOW: Record<string, { day: [string, number]; night: [string, number] }> =
  {
    Window: { day: ["#d1e6ff", 2.6], night: ["#08112e", 0.6] },
    CeilingLights: { day: ["#fff0d8", 0.9], night: ["#ffdcb2", 2.6] },
    LampShade: { day: ["#ffb86b", 0.5], night: ["#ffa85c", 2.4] },
    LedStrip: { day: ["#000000", 0], night: ["#8c40ff", 6] },
  };

type Level = { day: number; night: number };
/** The light rig (from the studio's own renders), day and night. */
const RIG: Record<string, Level> = {
  ambient: { day: 0.35, night: 0.05 },
  // Daylight through the window: a soft panel, and the sun's shadows.
  window: { day: 9, night: 0 },
  sun: { day: 2.2, night: 0 },
  fillBack: { day: 1.6, night: 0 },
  fillFront: { day: 1.4, night: 0 },
  // Night: a cool key spot from above, the ceiling cans, lamp and LED glow.
  key: { day: 0, night: 26 },
  cans: { day: 0, night: 5 },
  lamp: { day: 0, night: 2.2 },
  led: { day: 0, night: 7 },
  env: { day: 1, night: 0.55 },
};

const ease = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;
const mix = (r: Level, k: number) => r.day + (r.night - r.day) * k;

/** The ceiling can positions (x, z), as in the studio's renders. */
const CANS: [number, number][] = [-1.3, 0, 1.3].flatMap((x) =>
  [1.5, -0.3].map((z): [number, number] => [x, z]),
);

let rectInit = false;

const shadowed = (l: DirectionalLight | SpotLight) => {
  /* eslint-disable no-param-reassign */
  l.castShadow = true;
  l.shadow.bias = -0.0004;
  l.shadow.normalBias = 0.02;
  l.shadow.radius = 4;
  /* eslint-enable no-param-reassign */
};

export const Studio = () => {
  const { scene: model } = useGLTF(MODELS.studio);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const size = useThree((s) => s.size);
  if (!rectInit) {
    RectAreaLightUniformsLib.init();
    rectInit = true;
  }

  const room = useMemo(() => {
    const r = model.clone(true);
    r.traverse((o) => {
      o.layers.enable(ROOM_LAYER);
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.receiveShadow = true;
      mesh.castShadow = mesh.name === "Amps" || mesh.name === "LampStand";
    });
    return r;
  }, [model]);

  // The glowing parts' materials (cloned, so the cached model stays as is).
  const glow = useMemo(() => {
    const out: Record<string, MeshStandardMaterial[]> = {};
    Object.keys(GLOW).forEach((name) => {
      out[name] = [];
      room.getObjectByName(name)?.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const m = (mesh.material as MeshStandardMaterial).clone();
        mesh.material = m;
        out[name].push(m);
      });
    });
    return out;
  }, [room]);

  // The lights, built once (they also light the reflection capture).
  const rig = useMemo(() => {
    const ambient = new AmbientLight("#ffeedd", RIG.ambient.day);
    const win = new RectAreaLight("#fff8ee", RIG.window.day, 1.6, 1.3);
    win.position.set(2.62, 1.65, 0.65);
    win.lookAt(0, 0.4, 0.2);
    const sun = new DirectionalLight("#fff2dc", RIG.sun.day);
    sun.position.set(3, 4, -1);
    shadowed(sun);
    Object.assign(sun.shadow.camera, {
      left: -1.6,
      right: 1.6,
      top: 1.6,
      bottom: -1.6,
      near: 0.5,
      far: 9,
    });
    const fillBack = new RectAreaLight("#fff1e0", RIG.fillBack.day, 3, 3);
    fillBack.position.set(0, 2.8, -1.8);
    fillBack.lookAt(0, 0.5, 0.5);
    const fillFront = new RectAreaLight("#ffe9d2", RIG.fillFront.day, 2.5, 2.5);
    fillFront.position.set(0, 2.6, 2.2);
    fillFront.lookAt(0, 0.6, -0.2);
    const key = new SpotLight("#d9ccff", 0, 8, (55 * Math.PI) / 180, 0.6, 1.4);
    key.position.set(0.8, 2.6, 1.2);
    key.target.position.set(0, 0.6, -0.2);
    shadowed(key);
    const cans = CANS.map(([x, z]) => {
      const s = new SpotLight("#ffdcb2", 0, 5, (35 * Math.PI) / 180, 0.6, 1.5);
      s.position.set(x, 2.95, z);
      s.target.position.set(x, 0, z);
      return s;
    });
    const lamp = new SpotLight("#ffad61", 0, 7, Math.PI / 2.2, 1, 1.4);
    lamp.target.position.set(-1.2, 0, 0.6);
    const led = new RectAreaLight("#8c40ff", 0, 4.5, 0.05);
    const all: Object3D[] = [
      ambient,
      win,
      sun,
      sun.target,
      fillBack,
      fillFront,
      key,
      key.target,
      lamp,
      lamp.target,
      led,
    ];
    cans.forEach((c) => all.push(c, c.target));
    all.forEach((l) => l.layers.enable(ROOM_LAYER));
    return {
      ambient,
      win,
      sun,
      fillBack,
      fillFront,
      key,
      cans,
      lamp,
      led,
      all,
    };
  }, []);

  // The lamp and the LED strip sit where the model has them.
  useLayoutEffect(() => {
    room.updateMatrixWorld(true);
    const box = new Box3();
    const shade = room.getObjectByName("LampShade");
    if (shade) box.setFromObject(shade).getCenter(rig.lamp.position);
    const strip = room.getObjectByName("LedStrip");
    if (strip) {
      const c = box.setFromObject(strip).getCenter(new Vector3());
      rig.led.position.set(c.x, c.y + 0.03, c.z - 0.08);
      rig.led.lookAt(c.x, 0.6, 0);
    }
  }, [room, rig]);

  // The shell's two default lights are turned off: the studio brings its own.
  useLayoutEffect(() => {
    const own = new Set<Object3D>(rig.all);
    const dimmed: { light: Light; was: number }[] = [];
    scene.children.forEach((c) => {
      if (
        !own.has(c) &&
        (c instanceof AmbientLight || c instanceof DirectionalLight)
      )
        dimmed.push({ light: c, was: c.intensity });
    });
    const set = (on: boolean) => {
      dimmed.forEach((d) => {
        // eslint-disable-next-line no-param-reassign
        d.light.intensity = on ? d.was : 0;
      });
    };
    set(false);
    return () => set(true);
  }, [scene, rig]);

  // The reflections: the room rendered from the kit, as the environment.
  const capture = useMemo(() => {
    const target = new WebGLCubeRenderTarget(256, { type: HalfFloatType });
    const cam = new CubeCamera(0.05, 20, target);
    cam.position.set(0, 0.95, -0.1);
    cam.layers.set(ROOM_LAYER);
    cam.children.forEach((c) => c.layers.set(ROOM_LAYER));
    const pmrem = new PMREMGenerator(gl);
    const fallback = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    return {
      target,
      cam,
      pmrem,
      fallback,
      env: null as Texture | null,
      at: -1,
      pending: true,
    };
  }, [gl]);
  useEffect(() => {
    const before = scene.environment;
    scene.environment = capture.fallback;
    return () => {
      scene.environment = before;
      capture.env?.dispose();
      capture.fallback.dispose();
      capture.target.dispose();
      capture.pmrem.dispose();
    };
  }, [scene, capture]);

  const blend = useRef({ k: drums.night ? 1 : 0, from: 0, to: 0, at: -10 });
  const tmp = useMemo(() => new Color(), []);

  useFrame(() => {
    // The canvas is set up flat (no shadows, no tone curve) and can be
    // reconfigured on a resize, so these are kept on every frame.
    if (!gl.shadowMap.enabled || gl.shadowMap.type !== PCFSoftShadowMap) {
      gl.shadowMap.enabled = true;
      gl.shadowMap.type = PCFSoftShadowMap;
      gl.shadowMap.needsUpdate = true;
    }
    const b = blend.current;
    const target = drums.night ? 1 : 0;
    const now = performance.now() / 1000;
    if (target !== b.to) {
      b.from = b.k;
      b.to = target;
      b.at = now;
      capture.pending = true;
    }
    b.k = b.from + (b.to - b.from) * ease((now - b.at) / SWITCH);
    const { k } = b;
    if (gl.toneMapping !== AgXToneMapping) gl.toneMapping = AgXToneMapping;
    gl.toneMappingExposure = EXPOSURE.day + (EXPOSURE.night - EXPOSURE.day) * k;

    const phone = Math.min(size.width, size.height) < 600;
    const mapSize = phone ? SHADOW.phone : SHADOW.desktop;
    [rig.sun, rig.key].forEach((l) => {
      if (l.shadow.mapSize.x !== mapSize) {
        l.shadow.mapSize.set(mapSize, mapSize);
        l.shadow.map?.dispose();
        // eslint-disable-next-line no-param-reassign
        l.shadow.map = null;
      }
    });

    rig.ambient.intensity = mix(RIG.ambient, k);
    rig.win.intensity = mix(RIG.window, k);
    rig.sun.intensity = mix(RIG.sun, k);
    rig.sun.castShadow = k < 0.5;
    rig.fillBack.intensity = mix(RIG.fillBack, k);
    rig.fillFront.intensity = mix(RIG.fillFront, k);
    rig.key.intensity = mix(RIG.key, k);
    rig.key.castShadow = k >= 0.5;
    rig.cans.forEach((c) => {
      // eslint-disable-next-line no-param-reassign
      c.intensity = mix(RIG.cans, k);
    });
    rig.lamp.intensity = mix(RIG.lamp, k);
    rig.led.intensity = mix(RIG.led, k);
    Object.entries(GLOW).forEach(([name, g]) => {
      glow[name]?.forEach((m) => {
        m.emissive.set(g.day[0]).lerp(tmp.set(g.night[0]), k);
        // eslint-disable-next-line no-param-reassign
        m.emissiveIntensity = g.day[1] + (g.night[1] - g.day[1]) * k;
      });
    });
    scene.environmentIntensity = mix(RIG.env, k);

    // Re-capture the reflections while the light changes, then once settled.
    const settling = now - b.at < SWITCH + 0.1;
    if (capture.pending || (settling && now - capture.at > 0.2)) {
      capture.pending = settling;
      capture.at = now;
      capture.cam.update(gl, scene);
      const next = capture.pmrem.fromCubemap(capture.target.texture).texture;
      capture.env?.dispose();
      capture.env = next;
      scene.environment = next;
    }
  });

  return (
    <>
      <primitive object={room} />
      {rig.all.map((l) => (
        <primitive key={l.uuid} object={l} />
      ))}
    </>
  );
};
