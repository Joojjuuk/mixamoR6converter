import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import * as solver from "../src/lib/r6SolverV5.js";

const inputDir = path.resolve(process.argv[2] ?? "../hunter_awakening/assets/mixamo_fbx");
const outputDir = path.resolve(process.argv[3] ?? "../hunter_awakening/work/mixamo_r6_review");
const clipNames = ["HumanoidRootPart", "Torso", "Head", "Left Arm", "Right Arm", "Left Leg", "Right Leg"];

// FBXLoader only needs this small browser surface for its optional texture path.
(globalThis as any).window = {
  innerWidth: 1920,
  innerHeight: 1080,
  URL: { createObjectURL: () => "" },
};

type Frame = {
  time: number;
  rootPosition: THREE.Vector3;
  rootQuaternion: THREE.Quaternion;
  torsoQuaternion: THREE.Quaternion;
  headQuaternion: THREE.Quaternion;
  leftArmQuaternion: THREE.Quaternion;
  rightArmQuaternion: THREE.Quaternion;
  leftLegQuaternion: THREE.Quaternion;
  rightLegQuaternion: THREE.Quaternion;
  diagnostics: solver.SolverDiagnostics;
};

function xml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
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
    r00: e[0], r01: e[4], r02: e[8],
    r10: e[1], r11: e[5], r12: e[9],
    r20: e[2], r21: e[6], r22: e[10],
  };
}

function cframeXml(value: ReturnType<typeof cframe>) {
  return `<CoordinateFrame name="CFrame"><X>${number(value.x)}</X><Y>${number(value.y)}</Y><Z>${number(value.z)}</Z>`
    + `<R00>${number(value.r00)}</R00><R01>${number(value.r01)}</R01><R02>${number(value.r02)}</R02>`
    + `<R10>${number(value.r10)}</R10><R11>${number(value.r11)}</R11><R12>${number(value.r12)}</R12>`
    + `<R20>${number(value.r20)}</R20><R21>${number(value.r21)}</R21><R22>${number(value.r22)}</R22></CoordinateFrame>`;
}

function pose(name: string, value: ReturnType<typeof cframe>, children = "", root = false) {
  return `<Item class="Pose"><Properties><string name="Name">${xml(name)}</string>`
    + (root ? `<float name="Weight">0</float>` : "")
    + cframeXml(value)
    + (root ? "" : `<float name="Weight">1</float><token name="EasingStyle">0</token>`)
    + `</Properties>${children}</Item>`;
}

function keyframe(frame: Frame) {
  const identity = new THREE.Quaternion();
  const root = cframe(frame.rootPosition, frame.rootQuaternion);
  const torso = cframe(new THREE.Vector3(), frame.torsoQuaternion);
  const head = cframe(new THREE.Vector3(), frame.headQuaternion);
  const leftArm = cframe(new THREE.Vector3(), frame.leftArmQuaternion);
  const rightArm = cframe(new THREE.Vector3(), frame.rightArmQuaternion);
  const leftLeg = cframe(new THREE.Vector3(), frame.leftLegQuaternion);
  const rightLeg = cframe(new THREE.Vector3(), frame.rightLegQuaternion);
  const body = pose("Torso", torso, pose("Head", head) + pose("Left Arm", leftArm) + pose("Right Arm", rightArm));
  return `<Item class="Keyframe"><Properties><string name="Name">Keyframe</string><float name="Time">${number(frame.time)}</float></Properties>`
    + pose("HumanoidRootPart", root, body + pose("Left Leg", leftLeg) + pose("Right Leg", rightLeg), true)
    + `</Item>`;
}

function rbxmx(name: string, frames: Frame[]) {
  return `<?xml version='1.0' encoding='utf-8'?><roblox version="4"><Item class="KeyframeSequence"><Properties>`
    + `<string name="Name">${xml(name)}</string><bool name="Loop">false</bool><token name="Priority">2</token></Properties>`
    + frames.map(keyframe).join("") + `</Item></roblox>`;
}

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9 _.-]/g, "_").replace(/\s+/g, "_");
}

async function findFbx(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await findFbx(fullPath));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".fbx")) files.push(fullPath);
  }
  return files;
}

async function convert(file: string, index: number) {
  const bytes = await fs.readFile(file);
  const source = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), path.dirname(file));
  solver.fitSourceModel(source);
  const clip = source.animations[0];
  if (!clip) throw new Error("No animation clip found");
  const mixer = new THREE.AnimationMixer(source);
  mixer.clipAction(clip).play();
  mixer.setTime(0);
  source.updateMatrixWorld(true);
  const bones = solver.detectMixamoBones(source);
  if (!bones) throw new Error("Mixamo humanoid bone map not found");
  const duration = Math.max(clip.duration, 0.001);
  const reference = solver.measureSourceReference(mixer, source, bones, duration);
  const track = solver.buildPoseTrack(mixer, source, bones, reference, duration) as { fps: number; duration: number; samples: Frame[] };
  if (track.samples.length < 2) throw new Error("Solver produced fewer than two samples");
  const originalName = path.basename(file, path.extname(file));
  const relativeSource = path.relative(inputDir, file).replaceAll("\\", "/");
  const sourceParts = relativeSource.split("/");
  const packName = sourceParts.length > 1 ? sourceParts[sourceParts.length - 2] : "";
  const displayName = packName ? `${packName} · ${originalName}` : originalName;
  const name = safeName(packName ? `${packName}__${originalName}` : originalName);
  const out = path.join(outputDir, `${String(index + 1).padStart(2, "0")}_${name}`);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(`${out}.rbxmx`, rbxmx(name, track.samples), "utf8");
  await fs.writeFile(`${out}.json`, JSON.stringify({
    name,
    originalName,
    displayName,
    source: relativeSource,
    sourceSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    solver: solver.SOLVER_VERSION,
    fps: track.fps,
    duration: track.duration,
    frames: track.samples.length,
    diagnostics: track.samples.map((sample) => ({ time: sample.time, ...sample.diagnostics })),
  }, null, 2), "utf8");
  return { name, originalName, displayName, source: relativeSource, file: `${out}.rbxmx`, duration, frames: track.samples.length };
}

async function main() {
  const files = (await findFbx(inputDir)).sort((a, b) => {
    const left = path.relative(inputDir, a);
    const right = path.relative(inputDir, b);
    return left.localeCompare(right, "en", { sensitivity: "base" });
  });
  if (!files.length) throw new Error(`No FBX files found in ${inputDir}`);
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });
  const results = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    try {
      const result = await convert(file, index);
      results.push({ ...result, status: "converted" });
      console.log(`CONVERTED ${index + 1}/${files.length} ${result.originalName}`);
    } catch (error) {
      results.push({ name: path.basename(file, path.extname(file)), file, status: "failed", error: String(error) });
      console.error(`FAILED ${path.basename(file)}: ${String(error)}`);
    }
  }
  await fs.writeFile(path.join(outputDir, "manifest.json"), JSON.stringify({ solver: solver.SOLVER_VERSION, fps: 30, clips: results }, null, 2), "utf8");
  if (results.some((result) => result.status === "failed")) process.exitCode = 1;
}

await main();
