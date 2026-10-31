// The recording studio around the kit, and its light, day and night.
//
// The room's light is baked: its own lightmaps (day and night) light every
// surface exactly as in the studio's renders, so the room itself takes no
// live light. The glowing parts (window, ceiling panels, lamp shade, LED
// strip) shine at their day or night strength. The kit and the ghost hands
// take live light from the same rig the renders used (daylight through the
// window, a sun with soft shadows, fills; at night the ceiling cans, the lamp,
// the LED strip and a cool key), and reflect the studio through its own
// 360° light probe. Day and night blend smoothly (strict ease-out).
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import {
  AgXToneMapping,
  AmbientLight,
  Color,
  DirectionalLight,
  EquirectangularReflectionMapping,
  MeshBasicMaterial,
  PCFSoftShadowMap,
  PMREMGenerator,
  PointLight,
  RectAreaLight,
  SpotLight,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type Light,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type Texture,
} from "three";
// eslint-disable-next-line import/extensions
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
// eslint-disable-next-line import/extensions
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";

import { sound } from "./audio";
import { EXPOSURE } from "./look";
import { MODELS } from "./models";
import { drums } from "./state";

useGLTF.preload(MODELS.studio);

/** Day ⇄ night takes this long (s). */
const SWITCH = 0.9;
/** Shadow map size by screen (phones get a smaller one). */
const SHADOW = { desktop: 2048, phone: 1024 };
/** The lightmaps' strength (they hold light ÷ this, π included). */
const LIGHTMAP = { day: 6.241 * Math.PI, night: 10.633 * Math.PI };

type Glow = { color: [number, number, number]; strength: number };
/** The glowing parts, day and night (as in the studio's renders). */
const GLOW: Record<string, { day: Glow; night: Glow }> = {
  Window: {
    day: { color: [0.82, 0.9, 1.0], strength: 6 },
    night: { color: [0.03, 0.06, 0.16], strength: 1 },
  },
  CeilingLights: {
    day: { color: [1.0, 0.93, 0.82], strength: 2 },
    night: { color: [1.0, 0.86, 0.7], strength: 6 },
  },
  LampShade: {
    day: { color: [1.0, 0.72, 0.42], strength: 1.5 },
    night: { color: [1.0, 0.66, 0.36], strength: 5 },
  },
  LedStrip: {
    day: { color: [0, 0, 0], strength: 0 },
    night: { color: [0.55, 0.25, 1.0], strength: 12 },
  },
};

type Level = { day: number; night: number };
/**
 * The live light on the kit, day and night: the renders' rig, in the
 * renderer's units (sun: W/m²; spot and point: W / 4π² per steradian; area
 * panels: W / (π² × area)).
 */
const RIG: Record<string, Level> = {
  window: { day: 420 / (Math.PI ** 2 * 1.5 * 1.5), night: 0 },
  sun: { day: 1.2 * Math.PI, night: 0 },
  fillBack: { day: 120 / (Math.PI ** 2 * 3 * 3), night: 0 },
  fillFront: { day: 110 / (Math.PI ** 2 * 2.5 * 2.5), night: 0 },
  cans: { day: 0, night: 90 / (4 * Math.PI ** 2) },
  lamp: { day: 0, night: 60 / (4 * Math.PI ** 2) },
  led: { day: 0, night: 160 / (Math.PI ** 2 * 4.5 * 0.05) },
  key: { day: 0, night: 260 / (4 * Math.PI ** 2) },
};

const ease = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;
const mix = (r: Level, k: number) => r.day + (r.night - r.day) * k;

/** The ceiling can positions (x, z). */
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

/** Shared by every room surface: the two lightmaps and the blend between them. */
type Bake = {
  uNightMap: { value: Texture | null };
  uDayI: { value: number };
  uNightI: { value: number };
  uNight: { value: number };
};

/**
 * The room's own soft light, as a floor under the bake: wherever the
 * lightmap is darker than this, this shows instead. By day a soft window-lit
 * fill; at night the LED strip's purple wash up the back wall, warm pools
 * from the ceiling cans and the lamp's glow. (Light before the surface's own
 * colour, in the renderer's units.)
 */
const ROOM_FILL_GLSL = /* glsl */ `
varying vec3 vRoomPos;
uniform float uNight;
vec3 drumsRoomFill(vec3 p) {
  // Day: soft daylight, brighter towards the window wall (+x).
  vec3 window = vec3(2.6, 1.65, 0.65);
  float dw = length(p - window);
  vec3 day = vec3(1.0, 0.96, 0.9) * 1.15 + vec3(1.0, 0.97, 0.92) * 1.4 / (1.0 + dw * dw * 0.35);
  // Night: a dim base, the LED wash, the cans and the lamp.
  vec3 night = vec3(0.05, 0.045, 0.07);
  float back = smoothstep(1.2, 2.55, p.z);
  night += vec3(0.55, 0.25, 1.0) * 2.4 * back * exp(-max(0.0, p.y - 0.12) / 0.55);
  for (int i = 0; i < 6; i++) {
    float x = float(i / 2) * 1.3 - 1.3;
    float z = mod(float(i), 2.0) < 0.5 ? 1.5 : -0.3;
    vec3 d = p - vec3(x, 2.97, z);
    night += vec3(1.0, 0.86, 0.7) * 0.55 / (1.0 + dot(d, d) * 1.6);
  }
  vec3 dl = p - vec3(-2.05, 1.27, 1.25);
  night += vec3(1.0, 0.66, 0.36) * 1.3 / (1.0 + dot(dl, dl) * 2.2);
  return mix(day, night, uNight);
}
`;

/** The speakers' motion, shared by the amps' surfaces. */
type Speaker = {
  uLevel: { value: number };
  uLow: { value: number };
  uTime: { value: number };
};
/** How far the speakers move at full level (m): the cabinet, and the cone. */
const SPEAKER = { body: 0.0025, cone: 0.005, shake: 0.0008 };

/**
 * A room surface: its colour (and texture), lit only by the lightmaps. An
 * amp's surface also moves with the sound (`push`: its share of the
 * motion, the grille in front of the cone most).
 */
const bakedMaterial = (
  src: MeshStandardMaterial,
  day: Texture,
  bake: Bake,
  amp?: { speaker: Speaker; push: number; metres: number },
) => {
  const m = new MeshBasicMaterial({
    color: src.color,
    map: src.map,
    lightMap: day,
    lightMapIntensity: 1,
    side: src.side,
    transparent: src.transparent,
    opacity: src.opacity,
  });
  m.name = src.name;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, bake);
    if (amp) Object.assign(shader.uniforms, amp.speaker);
    const move = amp
      ? `
  {
    // The speaker: the body pulses with the sound, the cone with the bass,
    // and a strong low end adds a tiny shake.
    float push = (${SPEAKER.body.toFixed(4)} * (0.4 * uLevel + 0.6 * uLow)
      + ${SPEAKER.cone.toFixed(4)} * ${amp.push.toFixed(2)} * uLow) / ${amp.metres.toFixed(5)};
    transformed += normal * push;
    transformed.x += sin(uTime * 95.0) * ${SPEAKER.shake.toFixed(4)} * uLow / ${amp.metres.toFixed(5)};
  }`
      : "";
    // eslint-disable-next-line no-param-reassign
    shader.vertexShader = `varying vec3 vRoomPos;
${amp ? "uniform float uLevel;\nuniform float uLow;\nuniform float uTime;" : ""}
${shader.vertexShader
  .replace("#include <begin_vertex>", `#include <begin_vertex>${move}`)
  .replace(
    "#include <project_vertex>",
    `#include <project_vertex>
  vRoomPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
  )}`;
    // eslint-disable-next-line no-param-reassign
    shader.fragmentShader = `uniform sampler2D uNightMap;
uniform float uDayI;
uniform float uNightI;
${ROOM_FILL_GLSL}
${shader.fragmentShader.replace(
  "reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;",
  `vec3 baked = mix(
    texture2D( lightMap, vLightMapUv ).rgb * uDayI,
    texture2D( uNightMap, vLightMapUv ).rgb * uNightI,
    uNight ) * RECIPROCAL_PI;
  reflectedLight.indirectDiffuse += max( baked, drumsRoomFill( vRoomPos ) );`,
)}`;
  };
  m.customProgramCacheKey = () =>
    amp
      ? `drums-baked-amp-${amp.push}-${amp.metres.toFixed(5)}`
      : "drums-baked";
  return m;
};

export const Studio = () => {
  const { scene: model } = useGLTF(MODELS.studio);
  const [dayMap, nightMap] = useLoader(TextureLoader, [
    MODELS.lightmapDay,
    MODELS.lightmapNight,
  ]);
  const [envDay, envNight] = useLoader(RGBELoader, [
    MODELS.envDay,
    MODELS.envNight,
  ]);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const size = useThree((s) => s.size);
  if (!rectInit) {
    RectAreaLightUniformsLib.init();
    rectInit = true;
  }

  const bake = useMemo<Bake>(() => {
    [dayMap, nightMap].forEach((t) => {
      /* eslint-disable no-param-reassign */
      t.colorSpace = SRGBColorSpace;
      t.flipY = false;
      t.channel = 1;
      t.needsUpdate = true;
      /* eslint-enable no-param-reassign */
    });
    return {
      uNightMap: { value: nightMap },
      uDayI: { value: LIGHTMAP.day },
      uNightI: { value: LIGHTMAP.night },
      uNight: { value: drums.night ? 1 : 0 },
    };
  }, [dayMap, nightMap]);

  const speaker = useMemo<Speaker>(
    () => ({ uLevel: { value: 0 }, uLow: { value: 0 }, uTime: { value: 0 } }),
    [],
  );

  // The room: baked surfaces, and the glowing parts (unlit, their own colour).
  const { room, glow } = useMemo(() => {
    const r = model.clone(true);
    const made = new Map<Material, Material>();
    const glowing: Record<string, MeshBasicMaterial[]> = {};
    r.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.receiveShadow = false;
      mesh.castShadow = false;
      const src = mesh.material as MeshStandardMaterial;
      if (GLOW[mesh.name]) {
        const m = new MeshBasicMaterial({ color: "#000000" });
        mesh.material = m;
        glowing[mesh.name] = [...(glowing[mesh.name] ?? []), m];
        return;
      }
      // The amps move with the sound: their own materials.
      let p: Object3D | null = mesh;
      let isAmp = false;
      while (p) {
        if (p.name === "Amps") isAmp = true;
        p = p.parent;
      }
      if (isAmp) {
        mesh.material = bakedMaterial(src, dayMap, bake, {
          speaker,
          push: src.name === "Grille" ? 1 : 0.15,
          metres: mesh.getWorldScale(new Vector3()).x || 1,
        });
        return;
      }
      let m = made.get(src);
      if (!m) {
        m = bakedMaterial(src, dayMap, bake);
        made.set(src, m);
      }
      mesh.material = m;
    });
    return { room: r, glow: glowing };
  }, [model, dayMap, bake, speaker]);

  // The light probes (pre-filtered once).
  const envs = useMemo(() => {
    const pmrem = new PMREMGenerator(gl);
    const make = (t: Texture) => {
      // eslint-disable-next-line no-param-reassign
      t.mapping = EquirectangularReflectionMapping;
      return pmrem.fromEquirectangular(t).texture;
    };
    const out = { day: make(envDay), night: make(envNight) };
    pmrem.dispose();
    return out;
  }, [gl, envDay, envNight]);

  // The kit's live lights, built once.
  const rig = useMemo(() => {
    const win = new RectAreaLight("#fff8eb", RIG.window.day, 1.5, 1.5);
    win.position.set(2.55, 1.65, 0.65);
    win.lookAt(0, 0.4, 0.2);
    const sun = new DirectionalLight("#fff2d9", RIG.sun.day);
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
    const fillBack = new RectAreaLight("#f2f7ff", RIG.fillBack.day, 3, 3);
    fillBack.position.set(0, 2.8, -1.8);
    fillBack.lookAt(0, 0.5, 0.5);
    const fillFront = new RectAreaLight("#fff8f0", RIG.fillFront.day, 2.5, 2.5);
    fillFront.position.set(0, 2.6, 2.2);
    fillFront.lookAt(0, 0.6, -0.2);
    const cans = CANS.map(([x, z]) => {
      const s = new SpotLight("#ffdbb3", 0, 6, (35 * Math.PI) / 180, 0.6, 2);
      s.position.set(x, 2.97, z);
      s.target.position.set(x, 0, z);
      return s;
    });
    const lamp = new PointLight("#ffad61", 0, 8, 2);
    lamp.position.set(-2.05, 1.27, 1.25);
    const led = new RectAreaLight("#8c40ff", 0, 4.5, 0.05);
    led.position.set(0, 0.14, 2.52);
    led.lookAt(0, 0.6, 0);
    const key = new SpotLight("#d9ccff", 0, 8, (27.5 * Math.PI) / 180, 0.6, 2);
    key.position.set(0.8, 2.6, 1.2);
    key.target.position.set(0, 0.6, -0.2);
    shadowed(key);
    const all: Object3D[] = [
      win,
      sun,
      sun.target,
      fillBack,
      fillFront,
      lamp,
      led,
      key,
      key.target,
    ];
    cans.forEach((c) => all.push(c, c.target));
    return { win, sun, fillBack, fillFront, cans, lamp, led, key, all };
  }, []);

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

  useEffect(() => {
    const before = scene.environment;
    return () => {
      scene.environment = before;
      envs.day.dispose();
      envs.night.dispose();
    };
  }, [scene, envs]);

  const blend = useRef({ k: drums.night ? 1 : 0, from: 0, to: 0, at: -10 });
  const tmp = useMemo(() => ({ a: new Color(), b: new Color() }), []);

  useFrame((_, dt) => {
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

    // The room: the lightmaps' blend and the glowing parts.
    bake.uNight.value = k;
    // The speakers move with what the kit plays (still when silent).
    const lv = sound.levels(Math.min(dt, 0.1));
    speaker.uLevel.value = lv.level;
    speaker.uLow.value = lv.low;
    speaker.uTime.value = now;
    Object.entries(GLOW).forEach(([name, g]) => {
      const d = g.day;
      const n = g.night;
      tmp.a.setRGB(
        d.color[0] * d.strength,
        d.color[1] * d.strength,
        d.color[2] * d.strength,
      );
      tmp.b.setRGB(
        n.color[0] * n.strength,
        n.color[1] * n.strength,
        n.color[2] * n.strength,
      );
      glow[name]?.forEach((m) => m.color.copy(tmp.a).lerp(tmp.b, k));
    });

    // The kit's light and reflections.
    rig.win.intensity = mix(RIG.window, k);
    rig.sun.intensity = mix(RIG.sun, k);
    rig.sun.castShadow = k < 0.5;
    rig.fillBack.intensity = mix(RIG.fillBack, k);
    rig.fillFront.intensity = mix(RIG.fillFront, k);
    rig.cans.forEach((c) => {
      // eslint-disable-next-line no-param-reassign
      c.intensity = mix(RIG.cans, k);
    });
    rig.lamp.intensity = mix(RIG.lamp, k);
    rig.led.intensity = mix(RIG.led, k);
    rig.key.intensity = mix(RIG.key, k);
    rig.key.castShadow = k >= 0.5;
    const env = k < 0.5 ? envs.day : envs.night;
    if (scene.environment !== env) scene.environment = env;
    // Through the switch the reflections dim, then come up on the other probe.
    scene.environmentIntensity = 0.35 + 0.65 * Math.abs(1 - 2 * k);
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
