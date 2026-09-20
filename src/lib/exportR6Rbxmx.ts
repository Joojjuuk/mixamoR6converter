import * as THREE from "three";
import type { PoseSample } from "./r6SolverV4";

function xml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function number(value: number) {
  return Number(value.toFixed(7)).toString();
}

function cframe(position: THREE.Vector3, quaternion: THREE.Quaternion) {
  const matrix = new THREE.Matrix4().makeRotationFromQuaternion(quaternion);
  const e = matrix.elements;
  return {
    x: position.x,
    y: position.y,
    z: position.z,
    r00: e[0],
    r01: e[4],
    r02: e[8],
    r10: e[1],
    r11: e[5],
    r12: e[9],
    r20: e[2],
    r21: e[6],
    r22: e[10],
  };
}

function cframeXml(value: ReturnType<typeof cframe>) {
  return (
    `<CoordinateFrame name="CFrame"><X>${number(value.x)}</X><Y>${number(value.y)}</Y><Z>${number(value.z)}</Z>` +
    `<R00>${number(value.r00)}</R00><R01>${number(value.r01)}</R01><R02>${number(value.r02)}</R02>` +
    `<R10>${number(value.r10)}</R10><R11>${number(value.r11)}</R11><R12>${number(value.r12)}</R12>` +
    `<R20>${number(value.r20)}</R20><R21>${number(value.r21)}</R21><R22>${number(value.r22)}</R22></CoordinateFrame>`
  );
}

function pose(name: string, value: ReturnType<typeof cframe>, children = "", root = false) {
  return (
    `<Item class="Pose"><Properties><string name="Name">${xml(name)}</string>` +
    (root ? `<float name="Weight">0</float>` : "") +
    cframeXml(value) +
    (root ? "" : `<float name="Weight">1</float><token name="EasingStyle">0</token>`) +
    `</Properties>${children}</Item>`
  );
}

function keyframe(frame: PoseSample) {
  const root = cframe(frame.rootPosition, frame.rootQuaternion);
  const torso = cframe(new THREE.Vector3(), frame.torsoQuaternion);
  const head = cframe(new THREE.Vector3(), frame.headQuaternion);
  const leftArm = cframe(new THREE.Vector3(), frame.leftArmQuaternion);
  const rightArm = cframe(new THREE.Vector3(), frame.rightArmQuaternion);
  const leftLeg = cframe(new THREE.Vector3(), frame.leftLegQuaternion);
  const rightLeg = cframe(new THREE.Vector3(), frame.rightLegQuaternion);
  const body = pose(
    "Torso",
    torso,
    pose("Head", head) + pose("Left Arm", leftArm) + pose("Right Arm", rightArm)
  );
  return (
    `<Item class="Keyframe"><Properties><string name="Name">Keyframe</string><float name="Time">${number(frame.time)}</float></Properties>` +
    pose("HumanoidRootPart", root, body + pose("Left Leg", leftLeg) + pose("Right Leg", rightLeg), true) +
    `</Item>`
  );
}

export function sanitizeAnimationName(name: string): string {
  return name.replace(/[^a-zA-Z0-9 _.-]/g, "_").replace(/\s+/g, "_") || "Animation";
}

export function generateR6Rbxmx(name: string, frames: PoseSample[], loop = false): string {
  return (
    `<?xml version='1.0' encoding='utf-8'?><roblox version="4"><Item class="KeyframeSequence"><Properties>` +
    `<string name="Name">${xml(name)}</string><bool name="Loop">${loop ? "true" : "false"}</bool><token name="Priority">2</token></Properties>` +
    frames.map(keyframe).join("") +
    `</Item></roblox>`
  );
}

export function downloadRbxmx(filename: string, xmlContent: string) {
  const blob = new Blob([xmlContent], { type: "application/xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".rbxmx") ? filename : `${filename}.rbxmx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
