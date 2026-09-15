import * as THREE from "three";
import {
  applyPose,
  collectBones,
  createR6Rig as createBaseRig,
  detectMixamoBones,
  fitSourceModel,
  measureSourceReference,
  type BoneMap,
  type PoseSample,
  type PoseTrack,
  type R6Rig,
  type SolverDiagnostics,
  type SolverReference,
} from "@/lib/r6SolverV4";
import {
  CONTACT_EXIT_HEIGHT,
  assignContactStates,
  smoothSpeeds,
  stableGroundProbe,
  type ContactSample,
} from "@/lib/r6SolverV41";

export { applyPose, collectBones, detectMixamoBones, fitSourceModel, measureSourceReference };
export type { PoseTrack, SolverDiagnostics };

export const SOLVER_VERSION = "preview-v5";
export const SAMPLE_FPS = 30;

type Side = "left" | "right";
type LimbName = "leftArm" | "rightArm" | "leftLeg" | "rightLeg";
type FitWeights = { silhouette: number; upper: number; end: number; body: number; temporal: number };

export type LimbDebug = {
  pivot: THREE.Vector3;
  endpoint: THREE.Vector3;
  targets: THREE.Vector3[];
  error: number;
};

export type SolverDebugFrame = {
  torsoCenter: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  forward: THREE.Vector3;
  limbs: Record<LimbName, LimbDebug>;
  handTargets: Record<Side, THREE.Vector3>;
  contactLevel: Record<Side, number>;
  supportTarget: THREE.Vector3 | null;
  otherTarget: THREE.Vector3 | null;
  torsoErrorDeg: number;
  totalError: number;
};

export type PoseTrackV5 = PoseTrack & { samples: (PoseSample & { debug: SolverDebugFrame })[] };

const SIDES: Side[] = ["left", "right"];
const LIMBS: LimbName[] = ["leftArm", "rightArm", "leftLeg", "rightLeg"];
const EPSILON = 1e-6;
const PLANE_EPSILON = 1e-4;
const PLANE_FULL_CONFIDENCE = Math.sin(THREE.MathUtils.degToRad(20));
const X_AXIS = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const DOWN = new THREE.Vector3(0, -1, 0);
const FALLBACK_PLANE = new THREE.Vector3(-1, 0, 0);

// R6 geometry. Must match createR6Rig(): 2-stud limbs, torso centre 3 studs above
// the root, shoulders and hips hanging from the Torso (real R6 Motor6D tree).
const LIMB = 2;
const TORSO_CENTER = new THREE.Vector3(0, 3, 0);
const SHOULDER_CENTER = new THREE.Vector3(0, 0.65, 0);
const PIVOT: Record<LimbName, THREE.Vector3> = {
  leftArm: new THREE.Vector3(-1.5, 0.65, 0),
  rightArm: new THREE.Vector3(1.5, 0.65, 0),
  leftLeg: new THREE.Vector3(-0.5, -1, 0),
  rightLeg: new THREE.Vector3(0.5, -1, 0),
};

// Relative weights of the pose-fitting error terms (spec 004 §3).
const ARM_WEIGHTS: FitWeights = { silhouette: 1, upper: 1, end: 0.5, body: 0.3, temporal: 0.1 };
// Legs: the thigh decides where the leg points (a bent knee reads as "leg
// forward"); the reach still matters for swinging/kicking legs.
const LEG_WEIGHTS: FitWeights = { silhouette: 1, upper: 1, end: 0.6, body: 0, temporal: 0.1 };
// Rigid-torso twist weighted by R6 lever arms: shoulders sit 1.5 studs out, hips 0.5.
const TRUNK_SHOULDER_WEIGHT = 0.9;
const ROOT_PRIOR_WEIGHT = 0.05;
// A held leg never goes past horizontal-ish: keeps the block under the hip.
const MIN_LEG_DROP = 0.35;
const CROUCH_TRANSFER = 0.6;
const CROUCH_PASSES = 3;
// AnimationMixer wraps t === duration back to frame 0; sample just before it.
const END_EPSILON = 1e-3;
const HEAD_LIMIT = THREE.MathUtils.degToRad(50);
const ERROR_SAMPLES = [0.25, 0.5, 0.75, 1];

// Normalized limb polyline: offsets from the chain root divided by total length.
type Chain = { offsets: THREE.Vector3[]; fractions: number[]; length: number };

type Trunk = {
  quaternion: THREE.Quaternion;
  right: THREE.Vector3;
  up: THREE.Vector3;
  back: THREE.Vector3;
  shoulderCenter: THREE.Vector3;
  shoulderLine: THREE.Vector3;
  shoulderHalfWidth: number;
};

type SourceFrame = ContactSample & {
  trunk: Trunk | null;
  pelvis: THREE.Vector3;
  // Hip joint height above the source ground, per side: the leg's vertical span.
  hipHeights: Record<Side, number>;
  chains: Record<LimbName, Chain | null>;
  planes: Record<LimbName, THREE.Vector3>;
  hands: Record<Side, THREE.Vector3>;
  headDirection: THREE.Vector3;
};

type ExtraBones = { leftKnuckle?: THREE.Bone; rightKnuckle?: THREE.Bone; headTop?: THREE.Bone };

const worldPosition = (object: THREE.Object3D) => object.getWorldPosition(new THREE.Vector3());

export function createR6Rig(): R6Rig {
  const rig = createBaseRig();
  // Real R6: Left/Right Hip are Motor6Ds on the Torso, so torso lean carries the legs.
  rig.torsoFrame.add(rig.leftLegPivot, rig.rightLegPivot);
  rig.leftLegPivot.position.copy(PIVOT.leftLeg);
  rig.rightLegPivot.position.copy(PIVOT.rightLeg);
  return rig;
}

function makeChain(points: THREE.Vector3[]): Chain | null {
  let length = 0;
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    length += points[index].distanceTo(points[index - 1]);
    cumulative.push(length);
  }
  if (length < EPSILON) return null;
  return {
    offsets: points.map((point) => point.clone().sub(points[0]).divideScalar(length)),
    fractions: cumulative.map((value) => value / length),
    length,
  };
}

function chainAt(chain: Chain, t: number) {
  for (let index = 1; index < chain.offsets.length; index += 1) {
    if (t <= chain.fractions[index] || index === chain.offsets.length - 1) {
      const span = chain.fractions[index] - chain.fractions[index - 1];
      const alpha = span > EPSILON
        ? THREE.MathUtils.clamp((t - chain.fractions[index - 1]) / span, 0, 1)
        : 1;
      return chain.offsets[index - 1].clone().lerp(chain.offsets[index], alpha);
    }
  }
  return chain.offsets[chain.offsets.length - 1].clone();
}

// ∫₀¹ t·m(t) dt over the normalized polyline m. For a rigid stick t·d,
// ∫‖t·d − m(t)‖² dt = const − 2·d·moment: the silhouette-optimal stick is ∝ moment.
function silhouetteMoment(chain: Chain) {
  const moment = new THREE.Vector3();
  for (let index = 1; index < chain.offsets.length; index += 1) {
    const a = chain.fractions[index - 1];
    const b = chain.fractions[index];
    const start = chain.offsets[index - 1];
    moment.addScaledVector(start, (b * b - a * a) / 2);
    if (b - a > EPSILON) {
      const ramp = ((b ** 3 - a ** 3) / 3 - (a * (b * b - a * a)) / 2) / (b - a);
      moment.addScaledVector(chain.offsets[index].clone().sub(start), ramp);
    }
  }
  return moment;
}

// Every term is a squared distance between a point of the rigid limb
// (pivot + t·LIMB·d) and a target, so the cost is linear in the unit direction:
// cost = const − 2·d·g and the optimum is d = g/|g|. Extra terms add to g.
function fitVector(chain: Chain, weights: FitWeights, extra: THREE.Vector3) {
  const area = LIMB * LIMB;
  const g = silhouetteMoment(chain).multiplyScalar(weights.silhouette * area);
  const upper = chain.offsets[1].clone();
  if (weights.upper > 0 && upper.lengthSq() > EPSILON) {
    g.addScaledVector(upper.normalize(), weights.upper * area);
  }
  g.addScaledVector(chain.offsets[chain.offsets.length - 1], weights.end * area);
  return g.add(extra);
}

function limbError(chain: Chain, direction: THREE.Vector3) {
  let sum = 0;
  for (const t of ERROR_SAMPLES) {
    sum += direction.clone().multiplyScalar(t).sub(chainAt(chain, t)).multiplyScalar(LIMB).lengthSq();
  }
  return Math.sqrt(sum / ERROR_SAMPLES.length);
}

// Direction + bend-plane roll with sign continuity. planeLocal = upper × lower
// (unit segments), so its length is sin(bend): the plane is trusted in
// proportion to that, falling back to the previous plane as the limb straightens
// (a nearly straight chain has no defined elbow/knee plane to follow).
function limbQuaternion(
  directionLocal: THREE.Vector3,
  planeLocal: THREE.Vector3,
  previousPlane: THREE.Vector3 | null,
) {
  const yAxis = directionLocal.clone().negate().normalize();
  const reference = previousPlane ?? FALLBACK_PLANE;
  const plane = planeLocal.clone();
  if (plane.dot(reference) < 0) plane.negate();
  const confidence = THREE.MathUtils.clamp(plane.length() / PLANE_FULL_CONFIDENCE, 0, 1);
  if (plane.lengthSq() > EPSILON) plane.normalize();
  plane.multiplyScalar(confidence).addScaledVector(reference, 1 - confidence);
  if (plane.lengthSq() < EPSILON) plane.copy(reference);
  plane.normalize();

  let zAxis = plane.clone().addScaledVector(yAxis, -plane.dot(yAxis));
  for (const fallback of [previousPlane, FALLBACK_PLANE, Z_AXIS]) {
    if (zAxis.lengthSq() >= PLANE_EPSILON) break;
    if (fallback) zAxis = fallback.clone().addScaledVector(yAxis, -fallback.dot(yAxis));
  }
  zAxis.normalize();
  const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
  zAxis.crossVectors(xAxis, yAxis).normalize();

  return {
    quaternion: new THREE.Quaternion()
      .setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis))
      .normalize(),
    plane,
  };
}

// Same rotation, same hemisphere as the previous sample: slerp never takes the long way.
function continuous(current: THREE.Quaternion, previous: THREE.Quaternion | null) {
  const result = current.clone().normalize();
  if (previous && previous.dot(result) < 0) result.set(-result.x, -result.y, -result.z, -result.w);
  return result;
}

function findExtraBone(bones: THREE.Bone[], name: string) {
  return bones.find(
    (bone) => bone.name.toLowerCase().replace(/mixamorig/g, "").replace(/[^a-z0-9]/g, "") === name,
  );
}

function bendPlane(points: THREE.Vector3[]) {
  const upper = points[1].clone().sub(points[0]);
  const lower = points[2].clone().sub(points[1]);
  if (upper.lengthSq() < EPSILON || lower.lengthSq() < EPSILON) return new THREE.Vector3();
  return new THREE.Vector3().crossVectors(upper.normalize(), lower.normalize());
}

function sourceTrunk(bones: BoneMap): Trunk | null {
  const leftShoulder = worldPosition(bones.leftUpperArm);
  const rightShoulder = worldPosition(bones.rightUpperArm);
  const leftHip = worldPosition(bones.leftUpperLeg);
  const rightHip = worldPosition(bones.rightUpperLeg);
  const shoulderCenter = leftShoulder.clone().add(rightShoulder).multiplyScalar(0.5);
  const pelvis = leftHip.clone().add(rightHip).multiplyScalar(0.5);

  const up = shoulderCenter.clone().sub(pelvis);
  const shoulderLine = rightShoulder.clone().sub(leftShoulder);
  const hipLine = rightHip.sub(leftHip);
  if (up.lengthSq() < EPSILON || shoulderLine.lengthSq() < EPSILON || hipLine.lengthSq() < EPSILON) {
    return null;
  }
  up.normalize();
  const shoulderHalfWidth = shoulderLine.length() / 2;
  shoulderLine.normalize();

  const blended = shoulderLine
    .clone()
    .multiplyScalar(TRUNK_SHOULDER_WEIGHT)
    .addScaledVector(hipLine.normalize(), 1 - TRUNK_SHOULDER_WEIGHT);
  const back = new THREE.Vector3().crossVectors(blended, up);
  if (back.lengthSq() < EPSILON) return null;
  back.normalize();
  const right = new THREE.Vector3().crossVectors(up, back).normalize();

  return {
    quaternion: new THREE.Quaternion()
      .setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, back))
      .normalize(),
    right,
    up,
    back,
    shoulderCenter,
    shoulderLine,
    shoulderHalfWidth,
  };
}

function sampleSource(
  bones: BoneMap,
  extras: ExtraBones,
  reference: SolverReference,
  time: number,
): SourceFrame {
  const armPoints = (side: Side) => {
    const points = [
      worldPosition(bones[`${side}UpperArm`]),
      worldPosition(bones[`${side}ForeArm`]),
      worldPosition(bones[`${side}Hand`]),
    ];
    const knuckle = extras[`${side}Knuckle`];
    if (knuckle) points.push(worldPosition(knuckle));
    return points;
  };
  const legPoints = (side: Side) => [
    worldPosition(bones[`${side}UpperLeg`]),
    worldPosition(bones[`${side}LowerLeg`]),
    worldPosition(bones[`${side}Foot`]),
  ];

  const points: Record<LimbName, THREE.Vector3[]> = {
    leftArm: armPoints("left"),
    rightArm: armPoints("right"),
    leftLeg: legPoints("left"),
    rightLeg: legPoints("right"),
  };
  const leftProbe = stableGroundProbe(bones.leftFoot, bones.leftToe);
  const rightProbe = stableGroundProbe(bones.rightFoot, bones.rightToe);
  const head = worldPosition(bones.head);

  return {
    time,
    leftProbe,
    rightProbe,
    hipsY: worldPosition(bones.hips).y,
    leftFootLift: leftProbe.y - reference.sourceGroundY,
    rightFootLift: rightProbe.y - reference.sourceGroundY,
    leftFootSpeed: 0,
    rightFootSpeed: 0,
    state: "double",
    support: null,
    segmentId: 0,
    trunk: sourceTrunk(bones),
    pelvis: points.leftLeg[0].clone().add(points.rightLeg[0]).multiplyScalar(0.5),
    hipHeights: {
      left: points.leftLeg[0].y - reference.sourceGroundY,
      right: points.rightLeg[0].y - reference.sourceGroundY,
    },
    chains: {
      leftArm: makeChain(points.leftArm),
      rightArm: makeChain(points.rightArm),
      leftLeg: makeChain(points.leftLeg),
      rightLeg: makeChain(points.rightLeg),
    },
    planes: {
      leftArm: bendPlane(points.leftArm),
      rightArm: bendPlane(points.rightArm),
      leftLeg: bendPlane(points.leftLeg),
      rightLeg: bendPlane(points.rightLeg),
    },
    hands: {
      left: points.leftArm[points.leftArm.length - 1],
      right: points.rightArm[points.rightArm.length - 1],
    },
    headDirection: (extras.headTop ? worldPosition(extras.headTop) : head.clone())
      .sub(extras.headTop ? head : worldPosition(bones.torso)),
  };
}

// Normalized body space, lateral axis: the source centre line maps to the R6
// centre line and the source shoulder to the R6 shoulder pivot; beyond the
// shoulder the arm-length ratio applies. Keeps hanging arms vertical while hands
// that meet in front of the chest still meet on the wider R6 torso.
function lateralToR6(x: number, halfWidth: number, reachScale: number) {
  const pivot = PIVOT.rightArm.x;
  const magnitude = Math.abs(x);
  const mapped = magnitude <= halfWidth
    ? magnitude * (pivot / halfWidth)
    : pivot + (magnitude - halfWidth) * reachScale;
  return Math.sign(x) * mapped;
}

export function buildPoseTrack(
  mixer: THREE.AnimationMixer,
  sourceObject: THREE.Object3D,
  bones: BoneMap,
  reference: SolverReference,
  duration: number,
): PoseTrackV5 {
  const allBones = collectBones(sourceObject);
  const extras: ExtraBones = {
    leftKnuckle: findExtraBone(allBones, "lefthandmiddle1"),
    rightKnuckle: findExtraBone(allBones, "righthandmiddle1"),
    headTop: findExtraBone(allBones, "headtopend"),
  };

  const frameCount = Math.max(2, Math.ceil(duration * SAMPLE_FPS) + 1);
  const frames: SourceFrame[] = [];
  for (let index = 0; index < frameCount; index += 1) {
    const time = Math.min(index / SAMPLE_FPS, duration);
    mixer.setTime(Math.min(time, Math.max(0, duration - END_EPSILON)));
    sourceObject.updateMatrixWorld(true);
    frames.push(sampleSource(bones, extras, reference, time));
  }
  smoothSpeeds(frames);
  assignContactStates(frames, reference);

  // Source units → studs: the R6 leg (hip pivot 2 studs above the floor when
  // straight) maps to the source hip height with the leg at full extension, so a
  // lower source hip means a proportionally lower R6 hip.
  const extended: number[] = [];
  for (const frame of frames) {
    for (const side of SIDES) {
      const lift = side === "left" ? frame.leftFootLift : frame.rightFootLift;
      if (lift < CONTACT_EXIT_HEIGHT) extended.push(frame.hipHeights[side]);
    }
  }
  extended.sort((a, b) => a - b);
  const span = extended.length
    ? extended[Math.floor((extended.length - 1) * 0.95)]
    : ((frames[0].chains.leftLeg?.length ?? 0) + (frames[0].chains.rightLeg?.length ?? 0)) / 2;
  const scale = span > EPSILON ? LIMB / span : 1;

  const samples: PoseTrackV5["samples"] = [];
  const planeMemory: Record<LimbName, THREE.Vector3 | null> = {
    leftArm: null,
    rightArm: null,
    leftLeg: null,
    rightLeg: null,
  };
  let groundOffset: THREE.Vector3 | null = null;
  let trunk: Trunk | null = null;
  let yaw = 0;
  let previous: {
    root: THREE.Vector3;
    rootQuaternion: THREE.Quaternion;
    torsoQuaternion: THREE.Quaternion;
    headQuaternion: THREE.Quaternion;
    limbQuaternion: Record<LimbName, THREE.Quaternion>;
    limbDirection: Record<LimbName, THREE.Vector3>;
    pelvis: THREE.Vector3;
    contact: Record<Side, THREE.Vector3>;
    targets: Record<Side, THREE.Vector3>;
  } | null = null;

  for (const frame of frames) {
    trunk = frame.trunk ?? trunk;
    const torsoWorld = trunk?.quaternion.clone() ?? new THREE.Quaternion();
    const trunkRight = new THREE.Vector3(1, 0, 0).applyQuaternion(torsoWorld);
    if (Math.hypot(trunkRight.x, trunkRight.z) > 0.05) yaw = Math.atan2(-trunkRight.z, trunkRight.x);

    const rootQuaternion = continuous(
      new THREE.Quaternion().setFromAxisAngle(UP, yaw),
      previous?.rootQuaternion ?? null,
    );
    const torsoQuaternion = continuous(
      rootQuaternion.clone().invert().multiply(torsoWorld),
      previous?.torsoQuaternion ?? null,
    );
    const torso = rootQuaternion.clone().multiply(torsoQuaternion);
    const torsoInverse = torso.clone().invert();
    const toWorld = (local: THREE.Vector3) => local.clone().applyQuaternion(torso);

    // ---- Limb fits (world directions) -------------------------------------
    const directions = {} as Record<LimbName, THREE.Vector3>;
    const fits = {} as Record<LimbName, THREE.Vector3>;
    const handTargets = {} as Record<Side, THREE.Vector3>;

    for (const name of LIMBS) {
      const isArm = name.endsWith("Arm");
      const fitWeights = isArm ? ARM_WEIGHTS : LEG_WEIGHTS;
      const chain = frame.chains[name];
      const previousDirection = previous ? toWorld(previous.limbDirection[name]) : DOWN.clone();
      const extra = previousDirection.clone().multiplyScalar(fitWeights.temporal * LIMB * LIMB);

      if (isArm && chain && trunk) {
        const side: Side = name === "leftArm" ? "left" : "right";
        const hand = frame.hands[side].clone().sub(trunk.shoulderCenter);
        const reachScale = LIMB / chain.length;
        const targetLocal = SHOULDER_CENTER.clone().add(
          new THREE.Vector3(
            lateralToR6(hand.dot(trunk.right), trunk.shoulderHalfWidth, reachScale),
            hand.dot(trunk.up) * reachScale,
            hand.dot(trunk.back) * reachScale,
          ),
        );
        const offset = toWorld(targetLocal.sub(PIVOT[name]));
        handTargets[side] = offset.clone();
        extra.addScaledVector(offset, fitWeights.body * LIMB);
      }

      const g = chain ? fitVector(chain, fitWeights, extra) : extra;
      fits[name] = g;
      directions[name] = g.lengthSq() > EPSILON ? g.clone().normalize() : previousDirection;
    }

    // ---- Legs + root: contact solve in world space ------------------------
    const legName = (side: Side): LimbName => (side === "left" ? "leftLeg" : "rightLeg");
    const planeLocal = (name: LimbName) => frame.planes[name].clone().applyQuaternion(torsoInverse);
    const hipOffset = (side: Side) => TORSO_CENTER.clone().add(toWorld(PIVOT[legName(side)]));
    const cornerDrop = (side: Side, direction: THREE.Vector3) => {
      const name = legName(side);
      const local = limbQuaternion(
        direction.clone().applyQuaternion(torsoInverse),
        planeLocal(name),
        planeMemory[name],
      ).quaternion;
      const world = torso.clone().multiply(local);
      const x = X_AXIS.clone().applyQuaternion(world);
      const z = Z_AXIS.clone().applyQuaternion(world);
      return 0.5 * (Math.abs(x.y) + Math.abs(z.y));
    };
    // Lowest corner of the 1×2×1 leg block, relative to the root.
    const contactRelative = (side: Side, direction: THREE.Vector3) =>
      hipOffset(side)
        .addScaledVector(direction, LIMB)
        .sub(new THREE.Vector3(0, cornerDrop(side, direction), 0));

    const legDirection: Record<Side, THREE.Vector3> = {
      left: directions.leftLeg.clone(),
      right: directions.rightLeg.clone(),
    };
    const probe: Record<Side, THREE.Vector3> = { left: frame.leftProbe, right: frame.rightProbe };
    const lift: Record<Side, number> = { left: frame.leftFootLift, right: frame.rightFootLift };
    // Ground contact level c ∈ [0,1]: a continuous function of the source foot
    // height, 0 at the state machine's contact-exit height. No binary switches.
    const level = {} as Record<Side, number>;
    for (const side of SIDES) {
      level[side] = THREE.MathUtils.clamp(1 - lift[side] / CONTACT_EXIT_HEIGHT, 0, 1);
    }
    // One ground frame for the whole clip: a foot's target is its source foot,
    // scaled, plus a fixed offset. A planted source foot gives a fixed target
    // (the R6 foot stays exactly put), a sliding one (in-place clips) slides the
    // same, and nothing drifts or accumulates from step to step.
    if (!groundOffset) {
      groundOffset = contactRelative("left", legDirection.left)
        .add(contactRelative("right", legDirection.right))
        .multiplyScalar(0.5)
        .sub(probe.left.clone().add(probe.right).multiplyScalar(0.5 * scale))
        .setY(0);
    }
    const footTarget = (side: Side) =>
      probe[side]
        .clone()
        .multiplyScalar(scale)
        .add(groundOffset!)
        .setY(Math.max(0, lift[side]) * scale);
    const targets: Record<Side, THREE.Vector3> = {
      left: footTarget("left"),
      right: footTarget("right"),
    };

    // R6 legs cannot bend: a bent source leg becomes a leg swung out along the
    // thigh's heading, and the body drops with it. A held leg keeps its fitted
    // heading; how far it drops is a compromise between the source's own leg
    // extension (hip above its contact point, scaled — this is what makes a
    // crouch read as a crouch) and keeping the foot on its anchor (what stops a
    // hip bob from sliding the foot, since a near-vertical rigid leg turns a
    // small height change into a large one). CROUCH_TRANSFER is that dial.
    const sourceDrop = {} as Record<Side, number>;
    for (const side of SIDES) {
      sourceDrop[side] = THREE.MathUtils.clamp(
        ((frame.hipHeights[side] - lift[side]) * scale) / LIMB,
        MIN_LEG_DROP,
        1,
      );
    }
    const setLegDrop = (side: Side, drop: number) => {
      const heading = new THREE.Vector3(legDirection[side].x, 0, legDirection[side].z);
      if (heading.lengthSq() < EPSILON) heading.copy(toWorld(new THREE.Vector3(0, 0, -1))).setY(0);
      heading.setLength(Math.sqrt(Math.max(0, 1 - drop * drop)));
      legDirection[side] = new THREE.Vector3(heading.x, -drop, heading.z).normalize();
    };
    for (const side of SIDES) {
      if (level[side] > 0) setLegDrop(side, sourceDrop[side]);
    }

    // Contact weight ω = (|g|/LIMB²)·c⁴: a planted foot dominates a half-lifted
    // one (16:1) while two planted feet share evenly — c/(1−c) would make the
    // root swing between them on every 1 cm wobble of the source lift.
    const weights = {} as Record<Side, number>;
    for (const side of SIDES) {
      weights[side] = (fits[legName(side)].length() / (LIMB * LIMB)) * level[side] ** 4;
    }

    // Root: ω-weighted mean of the roots the held feet imply. The prior (previous
    // root carried by the source pelvis) only decides when no foot is loaded.
    const prior: THREE.Vector3 = previous
      ? previous.root.clone().addScaledVector(frame.pelvis.clone().sub(previous.pelvis), scale)
      : new THREE.Vector3();
    const solveRoot = () => {
      const sum: THREE.Vector3 = prior.clone().multiplyScalar(ROOT_PRIOR_WEIGHT);
      let total = ROOT_PRIOR_WEIGHT;
      for (const side of SIDES) {
        if (weights[side] <= 0) continue;
        const bottom = targets[side]
          .clone()
          .add(new THREE.Vector3(0, cornerDrop(side, legDirection[side]), 0));
        sum.addScaledVector(
          bottom.sub(hipOffset(side)).addScaledVector(legDirection[side], -LIMB),
          weights[side],
        );
        total += weights[side];
      }
      return sum.divideScalar(total);
    };
    let root: THREE.Vector3 = solveRoot();
    for (let pass = 0; pass < CROUCH_PASSES; pass += 1) {
      for (const side of SIDES) {
        if (weights[side] <= 0) continue;
        const hip = root.clone().add(hipOffset(side));
        const reach = Math.min(Math.hypot(targets[side].x - hip.x, targets[side].z - hip.z) / LIMB, 0.99);
        const anchored = Math.sqrt(1 - reach * reach);
        setLegDrop(side, THREE.MathUtils.lerp(anchored, sourceDrop[side], CROUCH_TRANSFER * level[side]));
      }
      root = solveRoot();
    }

    // Feet never go through the floor: tilt the leg toward horizontal.
    for (const side of SIDES) {
      for (let iteration = 0; iteration < 3; iteration += 1) {
        const hip = root.clone().add(hipOffset(side));
        const drop = cornerDrop(side, legDirection[side]);
        if (hip.y + legDirection[side].y * LIMB - drop >= -1e-4) break;
        const vertical = THREE.MathUtils.clamp((drop - hip.y) / LIMB, -1, 1);
        const heading = new THREE.Vector3(legDirection[side].x, 0, legDirection[side].z);
        if (heading.lengthSq() < EPSILON) heading.copy(toWorld(new THREE.Vector3(0, 0, -1))).setY(0);
        heading.normalize().multiplyScalar(Math.sqrt(1 - vertical * vertical));
        legDirection[side] = new THREE.Vector3(heading.x, vertical, heading.z).normalize();
      }
    }

    const contact: Record<Side, THREE.Vector3> = {
      left: root.clone().add(contactRelative("left", legDirection.left)),
      right: root.clone().add(contactRelative("right", legDirection.right)),
    };
    // Reported lock: the most loaded foot (the one the solve keeps planted).
    const support: Side | null = weights.left + weights.right <= 0
      ? null
      : weights.left >= weights.right ? "left" : "right";
    const other: Side | null = support ? (support === "left" ? "right" : "left") : null;
    // Plant error = how far the loaded foot slid this frame beyond what its source
    // foot moved (0 while a planted foot stays planted).
    const plantError = support && previous
      ? contact[support].clone().sub(previous.contact[support])
        .sub(targets[support].clone().sub(previous.targets[support]))
        .setY(0)
        .length()
      : 0;

    directions.leftLeg = legDirection.left;
    directions.rightLeg = legDirection.right;

    // ---- Local quaternions ------------------------------------------------
    const limbQuaternions = {} as Record<LimbName, THREE.Quaternion>;
    const limbDirections = {} as Record<LimbName, THREE.Vector3>;
    for (const name of LIMBS) {
      const local = directions[name].clone().applyQuaternion(torsoInverse);
      const solved = limbQuaternion(local, planeLocal(name), planeMemory[name]);
      planeMemory[name] = solved.plane;
      limbQuaternions[name] = continuous(solved.quaternion, previous?.limbQuaternion[name] ?? null);
      limbDirections[name] = local;
    }

    const headLocal = frame.headDirection.clone().applyQuaternion(torsoInverse);
    let headQuaternion = headLocal.lengthSq() > EPSILON
      ? new THREE.Quaternion().setFromUnitVectors(UP, headLocal.normalize())
      : new THREE.Quaternion();
    const headAngle = 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(headQuaternion.w), 0, 1));
    if (headAngle > HEAD_LIMIT) {
      headQuaternion = new THREE.Quaternion().slerp(headQuaternion, HEAD_LIMIT / headAngle);
    }
    headQuaternion = continuous(headQuaternion, previous?.headQuaternion ?? null);

    // ---- Diagnostics ------------------------------------------------------
    const limbs = {} as Record<LimbName, LimbDebug>;
    for (const name of LIMBS) {
      const chain = frame.chains[name];
      const pivot = root.clone().add(TORSO_CENTER).add(toWorld(PIVOT[name]));
      limbs[name] = {
        pivot,
        endpoint: pivot.clone().addScaledVector(directions[name], LIMB),
        targets: chain
          ? chain.offsets.slice(1).map((offset) => pivot.clone().addScaledVector(offset, LIMB))
          : [],
        error: chain ? limbError(chain, directions[name]) : 0,
      };
    }
    const torsoRight = X_AXIS.clone().applyQuaternion(torso);
    const torsoErrorDeg = trunk ? THREE.MathUtils.radToDeg(torsoRight.angleTo(trunk.shoulderLine)) : 0;
    const totalError = Math.sqrt(
      (LIMBS.reduce((sum, name) => sum + limbs[name].error ** 2, 0) +
        (THREE.MathUtils.degToRad(torsoErrorDeg) * PIVOT.rightArm.x) ** 2) /
        (LIMBS.length + 1),
    );

    samples.push({
      time: frame.time,
      rootPosition: root.clone(),
      rootQuaternion,
      torsoQuaternion,
      headQuaternion,
      leftArmQuaternion: limbQuaternions.leftArm,
      rightArmQuaternion: limbQuaternions.rightArm,
      leftLegQuaternion: limbQuaternions.leftLeg,
      rightLegQuaternion: limbQuaternions.rightLeg,
      diagnostics: {
        state: frame.state,
        support,
        rootY: root.y,
        rootXZ: Math.hypot(root.x, root.z),
        rootYawDeg: THREE.MathUtils.radToDeg(yaw),
        leftFootLift: frame.leftFootLift,
        rightFootLift: frame.rightFootLift,
        leftFootSpeed: frame.leftFootSpeed,
        rightFootSpeed: frame.rightFootSpeed,
        plantError,
      },
      debug: {
        torsoCenter: root.clone().add(TORSO_CENTER),
        right: torsoRight,
        up: UP.clone().applyQuaternion(torso),
        forward: toWorld(new THREE.Vector3(0, 0, -1)),
        limbs,
        handTargets: {
          left: limbs.leftArm.pivot.clone().add(handTargets.left ?? new THREE.Vector3()),
          right: limbs.rightArm.pivot.clone().add(handTargets.right ?? new THREE.Vector3()),
        },
        contactLevel: { ...level },
        supportTarget: support ? targets[support].clone() : null,
        otherTarget: other && weights[other] > 0 ? targets[other].clone() : null,
        torsoErrorDeg,
        totalError,
      },
    });

    previous = {
      root,
      rootQuaternion,
      torsoQuaternion,
      headQuaternion,
      limbQuaternion: limbQuaternions,
      limbDirection: limbDirections,
      pelvis: frame.pelvis.clone(),
      contact,
      targets,
    };
  }

  mixer.setTime(0);
  sourceObject.updateMatrixWorld(true);
  return { fps: SAMPLE_FPS, duration, samples };
}

// Debug data of the sample applyPose() takes its diagnostics from.
export function debugAt(track: PoseTrack, time: number): SolverDebugFrame | null {
  const samples = track.samples as PoseTrackV5["samples"];
  if (samples.length === 0 || !samples[0].debug) return null;
  const index = Math.round(THREE.MathUtils.clamp(time * track.fps, 0, samples.length - 1));
  return samples[index].debug;
}
