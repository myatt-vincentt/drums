// The ghost hands: a pale see-through hand gripping a drumstick, one per
// side. The hand's grip on the stick is part of the model (a real drummer's
// grip: the stick runs through the fist and out between the thumb and the
// index finger), so the app only places the whole hand: it puts the stick
// where it must be, and the hand comes with it.
//
// The model's contract: a root at the wrist, +Y from the wrist towards the
// knuckles, +Z out of the back of the hand; a child `Drumstick` (along its
// own +Y) with empties `Grip` (the fulcrum) and `Drumstick_Tip`.
import {
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Material,
  type Object3D,
} from "three";

export type Ghost = {
  root: Object3D;
  /** The grip (fulcrum) in the root's frame. */
  grip: Vector3;
  /** The stick's direction (grip → tip) in the root's frame. */
  axis: Vector3;
  /** The back of the hand in the root's frame (+Z). */
  back: Vector3;
  /** Grip to tip (m). */
  tipLength: number;
};

/** The ghost look: pale, cool and see-through, with soft highlights. */
export const ghostMaterial = () => {
  const m = new MeshStandardMaterial({
    color: "#e6f1ff",
    roughness: 0.35,
    metalness: 0,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    emissive: "#9fc4ff",
    emissiveIntensity: 0.12,
  });
  m.onBeforeCompile = (shader) => {
    // A soft glowing rim: brighter where the surface turns away from you.
    // eslint-disable-next-line no-param-reassign
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
      float ghostRim = 1.0 - abs(dot(normal, normalize(vViewPosition)));
      totalEmissiveRadiance += vec3(0.62, 0.8, 1.0) * pow(ghostRim, 2.2) * 0.9;
      diffuseColor.a = clamp(diffuseColor.a + pow(ghostRim, 2.0) * 0.35, 0.0, 1.0);`,
    );
  };
  m.customProgramCacheKey = () => "drums-ghost";
  return m;
};

const depthOnly = new MeshBasicMaterial({ colorWrite: false });

const isUnder = (o: Object3D, name: string) => {
  let n: Object3D | null = o;
  while (n) {
    if (n.name === name) return true;
    n = n.parent;
  }
  return false;
};

/** Reads a ghost hand model: where its grip and stick are. */
export const readGhost = (root: Object3D, ghostLook: Material): Ghost => {
  root.updateMatrixWorld(true);
  const inv = new Matrix4().copy(root.matrixWorld).invert();
  const at = (name: string) => {
    const o = root.getObjectByName(name);
    return o ? o.getWorldPosition(new Vector3()).applyMatrix4(inv) : null;
  };
  const grip = at("Grip") ?? new Vector3();
  const tip = at("Drumstick_Tip") ?? new Vector3(0, 0.27, 0);
  const axis = tip.clone().sub(grip);
  const tipLength = axis.length() || 0.27;
  axis.normalize();
  // The hand itself (not the stick) wears the ghost look. A depth-only copy
  // drawn first means only the hand's outer surface shows (no overlapping
  // insides), and the stick disappears into the fist.
  const hand: Mesh[] = [];
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.isMesh && !isUnder(mesh, "Drumstick")) hand.push(mesh);
  });
  hand.forEach((mesh) => {
    const depth = mesh.clone();
    depth.material = depthOnly;
    depth.renderOrder = 4;
    mesh.parent?.add(depth);
    // eslint-disable-next-line no-param-reassign
    mesh.material = ghostLook;
    // eslint-disable-next-line no-param-reassign
    mesh.renderOrder = 5;
  });
  // The back of the hand: the hand root's +Z.
  const handRoot = root.getObjectByName("GhostHand") ?? root;
  const back = new Vector3(0, 0, 1)
    .transformDirection(handRoot.matrixWorld)
    .transformDirection(inv);
  return { root, grip, axis, back, tipLength };
};

const qa = new Quaternion();
const m1 = new Matrix4();
const m2 = new Matrix4();
const bl = new Vector3();
const xl = new Vector3();
const bw = new Vector3();
const xw = new Vector3();

/**
 * Places a ghost so its stick runs from `grip` along `axis` (world), with
 * the back of the hand turned as near `back` as the stick allows.
 */
export const placeGhost = (
  g: Ghost,
  grip: Vector3,
  axis: Vector3,
  back: Vector3,
  scale = 1,
) => {
  // The model's own stick frame (axis, back, side), and the wanted one.
  bl.copy(g.back).addScaledVector(g.axis, -g.back.dot(g.axis)).normalize();
  xl.crossVectors(g.axis, bl);
  bw.copy(back).addScaledVector(axis, -back.dot(axis)).normalize();
  xw.crossVectors(axis, bw);
  m1.makeBasis(xl, g.axis, bl);
  m2.makeBasis(xw, axis, bw);
  m2.multiply(m1.transpose());
  qa.setFromRotationMatrix(m2);
  g.root.quaternion.copy(qa);
  g.root.scale.setScalar(scale);
  // The root sits so the grip lands on `grip`.
  g.root.position.copy(g.grip).multiplyScalar(scale).applyQuaternion(qa);
  g.root.position.negate().add(grip);
};
