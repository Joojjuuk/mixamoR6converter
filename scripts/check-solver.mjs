// Regression check for the R6 solver on a real Mixamo FBX (no browser needed):
//   node scripts/check-solver.mjs "path/to/Standing Melee Combo Attack Ver. 1.fbx"
// Asserts the invariants of spec 004: finite, deterministic, scrub-stable, no
// flips, feet on (never through) the floor.
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
// Resolve the "@/..." alias and extensionless imports of the TypeScript sources.
register(
  `data:text/javascript,${encodeURIComponent(`
    import { existsSync } from "node:fs";
    import { pathToFileURL, fileURLToPath } from "node:url";
    let src;
    export function initialize(data) { src = data.src; }
    export async function resolve(specifier, context, next) {
      if (specifier.startsWith("@/")) return next(pathToFileURL(src + "/" + specifier.slice(2) + ".ts").href, context);
      if (specifier.startsWith(".") && !/\\.[cm]?[jt]s$/.test(specifier) && context.parentURL?.endsWith(".ts")) {
        return next(specifier + ".ts", context);
      }
      return next(specifier, context);
    }
  `)}`,
  { parentURL: import.meta.url, data: { src: path.join(root, "src") } },
);

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/check-solver.mjs "<file.fbx>"');
  process.exit(2);
}

globalThis.window ??= { innerWidth: 1, innerHeight: 1, URL };
const THREE = await import("three");
const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
const solver = await import(pathToFileURL(path.join(root, "src/lib/r6SolverV5.ts")).href);

function build() {
  const bytes = readFileSync(file);
  const object = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  solver.fitSourceModel(object);
  const clip = object.animations[0];
  const mixer = new THREE.AnimationMixer(object);
  mixer.clipAction(clip).play();
  mixer.setTime(0);
  object.updateMatrixWorld(true);
  const bones = solver.detectMixamoBones(object);
  if (!bones) throw new Error("not a Mixamo skeleton");
  const reference = solver.measureSourceReference(mixer, object, bones, clip.duration);
  return solver.buildPoseTrack(mixer, object, bones, reference, clip.duration);
}

const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const QUATERNIONS = ["rootQuaternion", "torsoQuaternion", "headQuaternion", "leftArmQuaternion", "rightArmQuaternion", "leftLegQuaternion", "rightLegQuaternion"];

const track = build();
const again = build();
check(track.samples.length > 1, "empty pose track");

let worstFlip = 0;
let lowestFoot = Infinity;
track.samples.forEach((sample, index) => {
  const values = [...sample.rootPosition.toArray(), ...QUATERNIONS.flatMap((key) => sample[key].toArray())];
  check(values.every(Number.isFinite), `non-finite pose at ${sample.time.toFixed(2)}s`);
  const twin = again.samples[index];
  check(sample.rootPosition.equals(twin.rootPosition) && QUATERNIONS.every((key) => sample[key].equals(twin[key])), `non-deterministic sample at ${sample.time.toFixed(2)}s`);
  if (index > 0) {
    for (const key of QUATERNIONS.slice(3)) worstFlip = Math.max(worstFlip, track.samples[index - 1][key].angleTo(sample[key]));
  }
});

// Scrub: the same timestamp gives the same pose whatever was shown before.
const rig = solver.createR6Rig();
const poseAt = (t) => {
  solver.applyPose(rig, track, t);
  rig.root.updateMatrixWorld(true);
  return [rig.root.position.clone(), rig.leftLegPivot.getWorldQuaternion(new THREE.Quaternion())];
};
const probe = track.duration * 0.37;
const forward = poseAt(probe);
poseAt(track.duration);
poseAt(0);
const backward = poseAt(probe);
check(forward[0].equals(backward[0]) && forward[1].equals(backward[1]), "scrub changes the pose at the same timestamp");

// Feet: the lowest corner of each leg block never goes through the floor.
for (let index = 0; index < track.samples.length; index += 1) {
  solver.applyPose(rig, track, track.samples[index].time);
  rig.root.updateMatrixWorld(true);
  for (const pivot of [rig.leftLegPivot, rig.rightLegPivot]) {
    const q = pivot.getWorldQuaternion(new THREE.Quaternion());
    const bottom = pivot.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -2, 0).applyQuaternion(q));
    const drop = 0.5 * (Math.abs(new THREE.Vector3(1, 0, 0).applyQuaternion(q).y) + Math.abs(new THREE.Vector3(0, 0, 1).applyQuaternion(q).y));
    lowestFoot = Math.min(lowestFoot, bottom.y - drop);
  }
}
check(worstFlip < Math.PI / 2, `limb flips ${THREE.MathUtils.radToDeg(worstFlip).toFixed(0)}° in one frame`);
check(lowestFoot > -0.1, `foot ${lowestFoot.toFixed(2)} studs through the floor`);

const plant = track.samples.map((s) => s.diagnostics.plantError);
console.log(`${solver.SOLVER_VERSION} · ${track.samples.length} samples · worst limb step ${THREE.MathUtils.radToDeg(worstFlip).toFixed(0)}° · lowest foot ${lowestFoot.toFixed(3)} · plant err mean ${(plant.reduce((a, b) => a + b, 0) / plant.length).toFixed(3)}`);
if (failures.length) {
  console.error(`FAIL\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("OK");
