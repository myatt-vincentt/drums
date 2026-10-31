// How the kit is shaded: its own physically based materials (lacquered clear
// coat, chrome, bronze, coated heads, baked ambient occlusion) reflecting the
// studio, with a filmic tone curve so highlights roll off softly.
import { ShaderChunk, type Mesh, type Object3D } from "three";

/** Tone curve exposure, day and night (the studio's renders use 1). */
export const EXPOSURE = { day: 1, night: 1 };

/**
 * The studio's renders use AgX with its "Medium High Contrast" look; the
 * renderer's AgX has no looks, so a matching one is added to its curve: a
 * little more contrast and saturation.
 */
const LOOK = { power: 1.2, saturation: 1.15 };
if (!ShaderChunk.tonemapping_pars_fragment.includes("drumsLook")) {
  ShaderChunk.tonemapping_pars_fragment =
    ShaderChunk.tonemapping_pars_fragment.replace(
      "color = agxDefaultContrastApprox( color );",
      `color = agxDefaultContrastApprox( color );
	// drumsLook: a medium-high contrast look
	color = pow( max( color, vec3( 0.0 ) ), vec3( ${LOOK.power.toFixed(2)} ) );
	float drumsLuma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
	color = drumsLuma + ${LOOK.saturation.toFixed(2)} * ( color - drumsLuma );`,
    );
}

/** Sets up a model's meshes: casting and taking shadows (the model's own
 * materials are used as they are: clear coat, ambient occlusion and all). */
export const dressModel = (root: Object3D, shadows = true) => {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
  });
};
