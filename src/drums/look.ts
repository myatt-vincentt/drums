// How the kit is shaded: physically based materials (a lacquered clear coat
// on the shells, mirror chrome, bronze cymbals, coated heads) that reflect
// the studio itself, with a filmic tone curve so highlights roll off softly.
import {
  Color,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Material,
  type Mesh,
  type Object3D,
} from "three";

/** Tone curve exposure, day and night. */
export const EXPOSURE = { day: 0.88, night: 1.1 };

type Finish = {
  /** How strongly it reflects the room. */
  env: number;
  roughness?: number;
  metalness?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  color?: string;
};

/** Each kit material's finish (the model's own maps are kept). */
const FINISH: Record<string, Finish> = {
  // Lacquered wood shells: a deep red under a glossy clear coat.
  Shell: {
    env: 1,
    roughness: 0.42,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  },
  // Mirror chrome hardware.
  Chrome: { env: 1.1, roughness: 0.12, metalness: 1 },
  // Bronze: metal, its colour from the model's texture.
  Cymbal: { env: 1, metalness: 1, roughness: 0.32 },
  // Coated heads: soft, satin.
  Head: {
    env: 0.5,
    roughness: 0.62,
    metalness: 0,
    clearcoat: 0.15,
    clearcoatRoughness: 0.5,
  },
  Rubber: { env: 0.3, roughness: 0.8, metalness: 0 },
  Wood: {
    env: 0.5,
    roughness: 0.45,
    metalness: 0,
    clearcoat: 0.4,
    clearcoatRoughness: 0.25,
  },
};

const upgraded = new Map<Material, Material>();

/** A kit material with its finish: physical (clear coat) where it needs it. */
const finish = (m: Material): Material => {
  const done = upgraded.get(m);
  if (done) return done;
  const f = FINISH[m.name];
  const std = m as MeshStandardMaterial;
  if (!f || !("roughness" in std)) {
    upgraded.set(m, m);
    return m;
  }
  let out: MeshPhysicalMaterial;
  if ((m as MeshPhysicalMaterial).isMeshPhysicalMaterial) {
    out = m as MeshPhysicalMaterial;
  } else {
    // Keep every map and colour of the model's own material.
    out = new MeshPhysicalMaterial();
    // The standard copy carries every map and value; the clear coat is extra.
    MeshStandardMaterial.prototype.copy.call(out, std);
    out.name = m.name;
  }
  // Values the model already set (a clear coat, say) are kept.
  if (f.roughness !== undefined && !std.roughnessMap)
    out.roughness = f.roughness;
  if (f.metalness !== undefined) out.metalness = f.metalness;
  if (f.clearcoat !== undefined && out.clearcoat === 0) {
    out.clearcoat = f.clearcoat;
    out.clearcoatRoughness = f.clearcoatRoughness ?? 0.1;
  }
  if (f.color) out.color = new Color(f.color);
  out.envMapIntensity = f.env;
  out.needsUpdate = true;
  upgraded.set(m, out);
  return out;
};

/** Sets up a model's meshes: finishes, and casting / taking shadows. */
export const dressModel = (root: Object3D, shadows = true) => {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(finish)
      : finish(mesh.material);
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
  });
};
