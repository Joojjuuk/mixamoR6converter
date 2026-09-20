import * as THREE from "three";
import type { BoneMap } from "@/lib/r6SolverV4";
import type { SolverDebugFrame } from "@/lib/r6SolverV5";

// Diagnostic overlay for "Debug Solver". Drawn on top of the scene (no depth
// test) so targets inside the blocks stay visible. Useful, not pretty.
const COLOR = {
  landmark: 0xf472b6,
  target: 0x38bdf8,
  endpoint: 0xfacc15,
  error: 0xef4444,
  hand: 0xa78bfa,
  support: 0x22c55e,
  other: 0xf97316,
  right: 0xef4444,
  up: 0x22c55e,
  forward: 0x3b82f6,
};

function onTop<T extends THREE.Object3D>(object: T) {
  object.renderOrder = 999;
  return object;
}

function markerFactory(group: THREE.Group, radius: number) {
  const geometry = new THREE.SphereGeometry(radius, 10, 8);
  return (color: number, scale = 1) => {
    const mesh = onTop(
      new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, depthTest: false })),
    );
    mesh.scale.setScalar(scale);
    group.add(mesh);
    return mesh;
  };
}

function lineBuffer(group: THREE.Group) {
  const geometry = new THREE.BufferGeometry();
  const lines = onTop(
    new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }),
    ),
  );
  group.add(lines);
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();
  return {
    add(from: THREE.Vector3, to: THREE.Vector3, hex: number) {
      positions.push(from.x, from.y, from.z, to.x, to.y, to.z);
      color.setHex(hex);
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    },
    flush() {
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geometry.computeBoundingSphere();
      positions.length = 0;
      colors.length = 0;
    },
  };
}

// R6 side: projected targets, limb endpoints, error vectors, contact targets and
// torso axes, all in R6 world space from the pose track's debug frame.
export function createR6DebugOverlay() {
  const group = new THREE.Group();
  const marker = markerFactory(group, 0.1);
  const lines = lineBuffer(group);
  const targets = Array.from({ length: 12 }, () => marker(COLOR.target));
  const endpoints = Array.from({ length: 4 }, () => marker(COLOR.endpoint, 1.4));
  const hands = [marker(COLOR.hand, 1.2), marker(COLOR.hand, 1.2)];
  const support = marker(COLOR.support, 2.2);
  const other = marker(COLOR.other, 1.8);

  function update(frame: SolverDebugFrame | null) {
    group.visible = Boolean(frame);
    if (!frame) return;

    let targetIndex = 0;
    Object.values(frame.limbs).forEach((limb, index) => {
      endpoints[index].position.copy(limb.endpoint);
      lines.add(limb.pivot, limb.endpoint, COLOR.endpoint);
      let from = limb.pivot;
      for (const target of limb.targets) {
        const mesh = targets[targetIndex++];
        if (!mesh) break;
        mesh.visible = true;
        mesh.position.copy(target);
        lines.add(from, target, COLOR.target);
        from = target;
      }
      const last = limb.targets[limb.targets.length - 1];
      if (last) lines.add(limb.endpoint, last, COLOR.error);
    });
    for (; targetIndex < targets.length; targetIndex += 1) targets[targetIndex].visible = false;

    hands[0].position.copy(frame.handTargets.left);
    hands[1].position.copy(frame.handTargets.right);
    support.visible = Boolean(frame.supportTarget);
    if (frame.supportTarget) support.position.copy(frame.supportTarget);
    other.visible = Boolean(frame.otherTarget);
    if (frame.otherTarget) other.position.copy(frame.otherTarget);

    const axis = (direction: THREE.Vector3, color: number) =>
      lines.add(frame.torsoCenter, frame.torsoCenter.clone().addScaledVector(direction, 1.6), color);
    axis(frame.right, COLOR.right);
    axis(frame.up, COLOR.up);
    axis(frame.forward, COLOR.forward);
    lines.flush();
  }

  return { group, update };
}

// Mixamo side: the landmarks the solver reads, straight from the live bones.
export function createSourceLandmarkOverlay(bones: BoneMap) {
  const group = new THREE.Group();
  const marker = markerFactory(group, 0.06);
  const tracked = [
    bones.hips,
    bones.torso,
    bones.head,
    bones.leftUpperArm,
    bones.leftForeArm,
    bones.leftHand,
    bones.rightUpperArm,
    bones.rightForeArm,
    bones.rightHand,
    bones.leftUpperLeg,
    bones.leftLowerLeg,
    bones.leftFoot,
    bones.rightUpperLeg,
    bones.rightLowerLeg,
    bones.rightFoot,
    bones.leftToe,
    bones.rightToe,
  ].filter((bone): bone is THREE.Bone => Boolean(bone));
  const meshes = tracked.map(() => marker(COLOR.landmark));

  function update(visible: boolean) {
    group.visible = visible;
    if (!visible) return;
    tracked.forEach((bone, index) => bone.getWorldPosition(meshes[index].position));
  }

  return { group, update };
}
