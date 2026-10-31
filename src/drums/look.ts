// How the kit is lit and shaded: a small studio environment for the chrome,
// the cymbals and the lacquered shells to reflect, and a soft highlight
// roll-off so the gloss never clips to flat white.
import {
  Color,
  PMREMGenerator,
  type Material,
  type MeshStandardMaterial,
  type Texture,
  type WebGLRenderer,
} from "three";
// eslint-disable-next-line import/extensions
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/** The shells' lacquer (the model's own red, a touch brighter). */
export const SHELL_COLOR = "#7a0717";

/** How strongly each material reflects the studio. */
const ENV: Record<string, number> = {
  Shell: 0.9,
  Chrome: 0.7,
  Cymbal: 0.9,
  Head: 0.35,
  Rubber: 0.2,
  Wood: 0.3,
};

let env: Texture | null = null;

/** The studio reflection map (made once per renderer). */
export const studioEnvironment = (gl: WebGLRenderer) => {
  if (!env) {
    const pmrem = new PMREMGenerator(gl);
    env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }
  return env;
};

/**
 * The scene renders without tone mapping (so the camera picture stays true),
 * which lets bright highlights clip to flat white. The kit and sticks get
 * their own soft roll-off instead (Khronos PBR Neutral, a little under 1:1),
 * so the chrome and the cymbals keep their shading and glints stay small.
 */
const EXPOSURE = 0.95;
const NEUTRAL_GLSL = /* glsl */ `
vec3 drumsNeutral( vec3 color ) {
  const float start = 0.76;
  const float desaturation = 0.15;
  float x = min( color.r, min( color.g, color.b ) );
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max( color.r, max( color.g, color.b ) );
  if ( peak < start ) return color;
  float d = 1. - start;
  float newPeak = 1. - d * d / ( peak + d - start );
  color *= newPeak / peak;
  float g = 1. - 1. / ( desaturation * ( peak - newPeak ) + 1. );
  return mix( color, vec3( newPeak ), g );
}
`;

/* eslint-disable no-param-reassign */
const softHighlights = (m: Material) => {
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = `${NEUTRAL_GLSL}\n${shader.fragmentShader.replace(
      "#include <tonemapping_fragment>",
      `gl_FragColor.rgb = drumsNeutral( gl_FragColor.rgb * ${EXPOSURE.toFixed(2)} );`,
    )}`;
  };
  m.customProgramCacheKey = () => "drums-neutral";
};

/** Sets up one of the model's materials (each is shared, so once). */
export const dressMaterial = (m: Material, envMap: Texture) => {
  if (m.userData.dressed) return;
  m.userData.dressed = true;
  const std = m as MeshStandardMaterial;
  if ("envMap" in std) {
    std.envMap = envMap;
    std.envMapIntensity = ENV[m.name] ?? 0.5;
  }
  if (m.name === "Shell") std.color = new Color(SHELL_COLOR);
  softHighlights(m);
  m.needsUpdate = true;
};
/* eslint-enable no-param-reassign */
