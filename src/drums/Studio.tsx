// The recording studio around the kit, and its light, day and night.
// Its decor: an ON AIR sign (lit while you play), a "vincentt.studio" neon,
// an LED cove whose wash breathes with the music at night, and plants.
//
// The room's light is baked: its own lightmaps (day and night) light every
// surface exactly as in the studio's renders, so the room itself takes no
// live light. The glowing parts (window, ceiling panels, lamp shade, LED
// strip) shine at their day or night strength. The kit and the ghost hands
// take live light from the same rig the renders used (daylight through the
// window, a sun with soft shadows, fills; at night the ceiling cans, the lamp,
// the LED strip and a warm key), and reflect the studio through its own
// 360° light probe (the day one, dimmed at night). Day and night blend smoothly (strict ease-out).
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
import { LedFlash } from "./led";
import { drums, hitsSince } from "./state";

useGLTF.preload(MODELS.studio);

/** Day ⇄ night takes this long (s). */
const SWITCH = 0.9;
/** Shadow map size by screen (phones get a smaller one). */
const SHADOW = { desktop: 2048, phone: 1024 };
/** The lightmaps' strength (they hold light ÷ this, π included). */
const LIGHTMAP = { day: 10.869 * Math.PI, night: 39 };

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
  // The "vincentt.studio" neon: soft by day, strong at night.
  Neon: {
    day: { color: [1.0, 0.8, 0.55], strength: 3 },
    night: { color: [1.0, 0.8, 0.55], strength: 10 },
  },
  // The LED cove itself (its wash on the walls is in the room's surfaces).
  LedCove: {
    day: { color: [1.0, 0.86, 0.66], strength: 1.2 },
    night: { color: [0.8, 0.72, 1.0], strength: 1.6 },
  },
};

/** ON AIR: idle and lit (face and letters), and how long it stays lit (s). */
const ON_AIR = {
  idle: { face: [0.12, 0, 0], letters: [0.12, 0.1, 0.1] },
  lit: { face: [1, 0.015, 0.01], letters: [1, 0.8, 0.72] },
  strength: 1.8,
  hold: 4,
  fade: 0.8,
};
/**
 * The cove's wash on the walls, on top of the bake (which already holds its
 * steady glow): off by day; at night it breathes with the music.
 */
const COVE = {
  day: { color: [1.0, 0.86, 0.66], strength: 0 },
  night: { color: [0.8, 0.72, 1.0], strength: 0.05, music: 0.35 },
};

/** How bright the kit's reflections are at night (the day probe, dimmed). */
const NIGHT_REFLECTIONS = 0.6;

/**
 * The LEDs' colour flash on hits, by day and at night: on the cove strip, on
 * the low strip, as a wash on the walls and on the kit. By day it is softer
 * (it competes with the window). Kept low: brighter, the tone curve turns
 * the colour white.
 */
const LED_FLASH = {
  cove: { day: 1.1, night: 1.4 },
  strip: { day: 1.2, night: 1.5 },
  wash: { day: 0.25, night: 0.45 },
  kit: { day: 0.4, night: 0.6 },
};
const LED_KIT_COLOR = new Color("#8c40ff");

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
  // The LED strip on the kit at half the render's strength (gentler purple).
  led: { day: 0, night: 80 / (Math.PI ** 2 * 4.5 * 0.05) },
  // A warm-white key from above the front right keeps the cymbals bronze.
  key: { day: 0, night: 320 / (4 * Math.PI ** 2) },
};

const ease = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;
const mix = (r: Level, k: number) => r.day + (r.night - r.day) * k;
const addScaled = (to: Color, c: Color, s: number) => {
  /* eslint-disable no-param-reassign */
  to.r += c.r * s;
  to.g += c.g * s;
  to.b += c.b * s;
  /* eslint-enable no-param-reassign */
};

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
  /** The LED cove's wash on the walls (a mask on the lightmap's layout). */
  uCoveMask: { value: Texture | null };
  uCove: { value: Color };
};

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
  // Leaves are cut out of their texture.
  if (src.name.startsWith("Leaf")) m.alphaTest = 0.5;
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
    shader.vertexShader = `${amp ? "uniform float uLevel;\nuniform float uLow;\nuniform float uTime;" : ""}
${shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>${move}`)}`;
    // eslint-disable-next-line no-param-reassign
    shader.fragmentShader = `uniform sampler2D uNightMap;
uniform float uDayI;
uniform float uNightI;
uniform float uNight;
uniform sampler2D uCoveMask;
uniform vec3 uCove;
${shader.fragmentShader
  .replace(
    "reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;",
    `reflectedLight.indirectDiffuse += mix(
    texture2D( lightMap, vLightMapUv ).rgb * uDayI,
    texture2D( uNightMap, vLightMapUv ).rgb * uNightI,
    uNight ) * RECIPROCAL_PI;`,
  )
  .replace(
    "vec3 outgoingLight = reflectedLight.indirectDiffuse;",
    `vec3 outgoingLight = reflectedLight.indirectDiffuse;
  // The LED cove's wash (it glows, whatever the surface's colour).
  outgoingLight += texture2D( uCoveMask, vLightMapUv ).r * uCove;`,
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
  const [dayMap, nightMap, coveMask] = useLoader(TextureLoader, [
    MODELS.lightmapDay,
    MODELS.lightmapNight,
    MODELS.coveMask,
  ]);
  const envDay = useLoader(RGBELoader, MODELS.envDay);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const size = useThree((s) => s.size);
  if (!rectInit) {
    RectAreaLightUniformsLib.init();
    rectInit = true;
  }

  const bake = useMemo<Bake>(() => {
    [dayMap, nightMap, coveMask].forEach((t) => {
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
      uCoveMask: { value: coveMask },
      uCove: { value: new Color(0, 0, 0) },
    };
  }, [dayMap, nightMap, coveMask]);

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
      // Glowing parts are unlit, their own colour (by material).
      const mats = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      if (mats.every((mt) => GLOW[mt.name] || mt.name.startsWith("OnAir"))) {
        const made2 = mats.map((mt) => {
          const m = new MeshBasicMaterial({ color: "#000000", side: mt.side });
          glowing[mt.name] = [...(glowing[mt.name] ?? []), m];
          return m;
        });
        mesh.material = Array.isArray(mesh.material) ? made2 : made2[0];
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

  // The light probe (pre-filtered once).
  const envMap = useMemo(() => {
    const pmrem = new PMREMGenerator(gl);
    envDay.mapping = EquirectangularReflectionMapping;
    const out = pmrem.fromEquirectangular(envDay).texture;
    pmrem.dispose();
    return out;
  }, [gl, envDay]);

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
    const key = new SpotLight("#fff0dc", 0, 8, (27.5 * Math.PI) / 180, 0.6, 2);
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
      envMap.dispose();
    };
  }, [scene, envMap]);

  const blend = useRef({ k: drums.night ? 1 : 0, from: 0, to: 0, at: -10 });
  const tmp = useMemo(() => ({ a: new Color(), b: new Color() }), []);
  const led = useMemo(
    () => ({ flash: new LedFlash(), seq: drums.seq, finish: -1 }),
    [],
  );

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
    // The music's pulse (at night the cove breathes with it).
    const beat = Math.min(1.5, 0.5 * lv.level + 0.8 * lv.low);
    const cove = glow.LedCove ?? [];
    cove.forEach((m) => m.color.multiplyScalar(1 + 0.6 * beat * k));
    const cd = COVE.day;
    const cn = COVE.night;
    bake.uCove.value
      .setRGB(cd.color[0], cd.color[1], cd.color[2])
      .multiplyScalar(cd.strength)
      .lerp(
        tmp.b
          .setRGB(cn.color[0], cn.color[1], cn.color[2])
          .multiplyScalar(cn.strength + cn.music * beat),
        k,
      );
    // The LEDs flash the colour of what you hit (a rainbow after a song).
    hitsSince(led.seq).forEach((e) => {
      led.flash.hit(e.piece, e.velocity);
      led.seq = e.seq;
    });
    if (drums.finish && drums.finish.at !== led.finish) {
      led.finish = drums.finish.at;
      led.flash.celebrate(drums.finish.at / 1000);
    }
    led.flash.update(Math.min(dt, 0.1), now);
    const a = led.flash.amount;
    if (a > 0.001) {
      // The LEDs turn to the flash's colour (as lit as the flash).
      const fc = led.flash.color;
      tmp.a.copy(fc).multiplyScalar(1 / Math.max(fc.r, fc.g, fc.b, 1e-3));
      cove.forEach((m) =>
        addScaled(
          m.color.multiplyScalar(1 - a),
          tmp.a,
          a * mix(LED_FLASH.cove, k),
        ),
      );
      (glow.LedStrip ?? []).forEach((m) =>
        addScaled(
          m.color.multiplyScalar(1 - a),
          tmp.a,
          a * mix(LED_FLASH.strip, k),
        ),
      );
      addScaled(
        bake.uCove.value.multiplyScalar(1 - a),
        tmp.a,
        a * mix(LED_FLASH.wash, k),
      );
      rig.led.color.copy(LED_KIT_COLOR).lerp(tmp.a, a);
    } else rig.led.color.copy(LED_KIT_COLOR);
    // ON AIR: lit while you play (and all through Play), fading after a
    // few quiet seconds; it flashes when a song ends.
    const lastHit = Math.max(...Object.values(drums.hitAt)) / 1000;
    const quiet = performance.now() / 1000 - lastHit;
    let lit =
      drums.session?.mode === "play"
        ? 1
        : 1 - Math.min(1, Math.max(0, (quiet - ON_AIR.hold) / ON_AIR.fade));
    if (drums.finish) {
      const e = (performance.now() - drums.finish.at) / 1000;
      if (e < 1.6) lit = Math.floor(e / 0.2) % 2 === 0 ? 1 : 0.15;
    }
    (["face", "letters"] as const).forEach((part) => {
      const idle = ON_AIR.idle[part];
      const on = ON_AIR.lit[part];
      tmp.a.setRGB(idle[0], idle[1], idle[2]);
      tmp.b.setRGB(on[0], on[1], on[2]).multiplyScalar(ON_AIR.strength);
      const list = glow[part === "face" ? "OnAirFace" : "OnAirLetters"] ?? [];
      list.forEach((m) => m.color.copy(tmp.a).lerp(tmp.b, lit));
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
    rig.led.intensity =
      mix(RIG.led, k) + a * RIG.led.night * mix(LED_FLASH.kit, k);
    rig.key.intensity = mix(RIG.key, k);
    rig.key.castShadow = k >= 0.5;
    // The kit reflects the day probe at night too, dimmed: the night probe
    // alone leaves the cymbals a dull copper and the heads purple.
    if (scene.environment !== envMap) scene.environment = envMap;
    scene.environmentIntensity = 1 + (NIGHT_REFLECTIONS - 1) * k;
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
