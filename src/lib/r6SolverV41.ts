import * as THREE from "three";
import {
  applyPose,
  collectBones,
  createR6Rig,
  detectMixamoBones,
  fitSourceModel,
  measureSourceReference,
  type BoneMap,
  type ContactState,
  type PoseSample,
  type PoseTrack,
  type R6Rig,
  type SolverDiagnostics,
  type SolverReference,
  type SupportSide,
} from "@/lib/r6SolverV4";

export {
  applyPose,
  collectBones,
  createR6Rig,
  detectMixamoBones,
  fitSourceModel,
  measureSourceReference,
};
export type { PoseTrack, SolverDiagnostics };

export const SOLVER_VERSION = "preview-v4.1";
export const SAMPLE_FPS = 30;

const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const FALLBACK_PLANE = new THREE.Vector3(-1, 0, 0);
const EPSILON = 1e-6;
const PLANE_EPSILON = 1e-4;
const R6_LIMB_LENGTH = 2;
const LEFT_LEG_PIVOT = new THREE.Vector3(-0.5, 2, 0);
const RIGHT_LEG_PIVOT = new THREE.Vector3(0.5, 2, 0);

const FOOT_AIRBORNE_THRESHOLD = 0.45;
const HIP_AIRBORNE_THRESHOLD = 0.2;
const CONTACT_ENTER_HEIGHT = 0.23;
export const CONTACT_EXIT_HEIGHT = 0.39;
const CONTACT_ENTER_SPEED = 1.8;
const CONTACT_EXIT_SPEED = 3.2;
const SUPPORT_SWITCH_FRAMES = 4;
const SUPPORT_SWITCH_MARGIN = 0.06;
const ROOT_XZ_LIMIT = 0.7;
const ROOT_MAX_STEP = 0.18;

const ARM_UPPER_WEIGHT_MIN = 0.8;
const ARM_UPPER_WEIGHT_MAX = 0.98;
const LEG_UPPER_WEIGHT_MIN = 0.16;
const LEG_UPPER_WEIGHT_MAX = 0.46;

type BodyFrame = {
  quaternion: THREE.Quaternion;
  forward: THREE.Vector3;
};

type PlaneMemory = {
  leftArm: THREE.Vector3 | null;
  rightArm: THREE.Vector3 | null;
  leftLeg: THREE.Vector3 | null;
  rightLeg: THREE.Vector3 | null;
};

type RawSample = {
  time: number;
  rootQuaternion: THREE.Quaternion;
  torsoQuaternion: THREE.Quaternion;
  headQuaternion: THREE.Quaternion;
  leftArmQuaternion: THREE.Quaternion;
  rightArmQuaternion: THREE.Quaternion;
  leftLegQuaternion: THREE.Quaternion;
  rightLegQuaternion: THREE.Quaternion;
  leftProbe: THREE.Vector3;
  rightProbe: THREE.Vector3;
  hipsY: number;
  rootYawDeg: number;
  leftFootLift: number;
  rightFootLift: number;
  leftFootSpeed: number;
  rightFootSpeed: number;
  state: ContactState;
  support: SupportSide;
  segmentId: number;
};

// Subset used by the contact state machine; preview-v5 reuses it unchanged.
export type ContactSample = Pick<
  RawSample,
  | "time"
  | "leftProbe"
  | "rightProbe"
  | "hipsY"
  | "leftFootLift"
  | "rightFootLift"
  | "leftFootSpeed"
  | "rightFootSpeed"
  | "state"
  | "support"
  | "segmentId"
>;

function worldPosition(object: THREE.Object3D) {
  return object.getWorldPosition(new THREE.Vector3());
}

function direction(from: THREE.Vector3, to: THREE.Vector3) {
  const result = to.clone().sub(from);
  return result.lengthSq() < EPSILON ? null : result.normalize();
}

function buildBodyFrame(bones: BoneMap): BodyFrame | null {
  const hips = worldPosition(bones.hips);
  const chest = worldPosition(bones.torso);
  const leftShoulder = worldPosition(bones.leftUpperArm);
  const rightShoulder = worldPosition(bones.rightUpperArm);

  const up = chest.sub(hips);
  const shoulderRight = rightShoulder.sub(leftShoulder);
  if (up.lengthSq() < EPSILON || shoulderRight.lengthSq() < EPSILON) return null;

  up.normalize();
  shoulderRight.normalize();
  const forward = new THREE.Vector3().crossVectors(shoulderRight, up);
  if (forward.lengthSq() < EPSILON) return null;
  forward.normalize();

  const right = new THREE.Vector3().crossVectors(up, forward).normalize();
  const correctedUp = new THREE.Vector3().crossVectors(forward, right).normalize();
  const matrix = new THREE.Matrix4().makeBasis(right, correctedUp, forward);

  return {
    quaternion: new THREE.Quaternion().setFromRotationMatrix(matrix).normalize(),
    forward,
  };
}

function yawFromForward(forward: THREE.Vector3) {
  const flat = new THREE.Vector3(forward.x, 0, forward.z);
  if (flat.lengthSq() < EPSILON) {
    return { yaw: 0, quaternion: new THREE.Quaternion() };
  }
  flat.normalize();
  const yaw = Math.atan2(flat.x, flat.z);
  return {
    yaw,
    quaternion: new THREE.Quaternion().setFromAxisAngle(UP, yaw),
  };
}

function clampLocalRotation(
  quaternion: THREE.Quaternion,
  limitsDeg: { x: number; y: number; z: number },
) {
  const euler = new THREE.Euler().setFromQuaternion(quaternion, "YXZ");
  euler.x = THREE.MathUtils.clamp(
    euler.x,
    THREE.MathUtils.degToRad(-limitsDeg.x),
    THREE.MathUtils.degToRad(limitsDeg.x),
  );
  euler.y = THREE.MathUtils.clamp(
    euler.y,
    THREE.MathUtils.degToRad(-limitsDeg.y),
    THREE.MathUtils.degToRad(limitsDeg.y),
  );
  euler.z = THREE.MathUtils.clamp(
    euler.z,
    THREE.MathUtils.degToRad(-limitsDeg.z),
    THREE.MathUtils.degToRad(limitsDeg.z),
  );
  return new THREE.Quaternion().setFromEuler(euler).normalize();
}

function blendedChainDirection(
  first: THREE.Vector3,
  middle: THREE.Vector3,
  end: THREE.Vector3,
  minWeight: number,
  maxWeight: number,
  bendScale: number,
) {
  const upper = direction(first, middle);
  const lower = direction(middle, end);
  const reach = direction(first, end);
  if (!upper) return reach;
  if (!reach) return upper;

  const bend = lower ? upper.angleTo(lower) : 0;
  const bendFactor = THREE.MathUtils.clamp(bend / bendScale, 0, 1);
  const upperWeight = THREE.MathUtils.lerp(minWeight, maxWeight, bendFactor);
  return upper
    .clone()
    .multiplyScalar(upperWeight)
    .add(reach.clone().multiplyScalar(1 - upperWeight))
    .normalize();
}

function chainQuaternion(
  firstWorld: THREE.Vector3,
  middleWorld: THREE.Vector3,
  endWorld: THREE.Vector3,
  parentInverse: THREE.Quaternion,
  previousPlane: THREE.Vector3 | null,
  weights: { min: number; max: number; bendScale: number },
) {
  const targetWorld = blendedChainDirection(
    firstWorld,
    middleWorld,
    endWorld,
    weights.min,
    weights.max,
    weights.bendScale,
  );
  if (!targetWorld) {
    return { quaternion: new THREE.Quaternion(), plane: previousPlane?.clone() ?? null };
  }

  const upperLocal = middleWorld.clone().sub(firstWorld).applyQuaternion(parentInverse);
  const lowerLocal = endWorld.clone().sub(middleWorld).applyQuaternion(parentInverse);
  if (upperLocal.lengthSq() < EPSILON || lowerLocal.lengthSq() < EPSILON) {
    const targetLocal = targetWorld.clone().applyQuaternion(parentInverse).normalize();
    return {
      quaternion: new THREE.Quaternion().setFromUnitVectors(DOWN, targetLocal).normalize(),
      plane: previousPlane?.clone() ?? null,
    };
  }
  upperLocal.normalize();
  lowerLocal.normalize();

  const targetLocal = targetWorld.clone().applyQuaternion(parentInverse).normalize();
  const yAxis = targetLocal.clone().multiplyScalar(-1).normalize();

  let plane = new THREE.Vector3().crossVectors(upperLocal, lowerLocal);
  if (plane.lengthSq() < PLANE_EPSILON) {
    plane = previousPlane?.clone() ?? FALLBACK_PLANE.clone();
  } else {
    plane.normalize();
    if (previousPlane) {
      if (plane.dot(previousPlane) < 0) plane.multiplyScalar(-1);
    } else if (plane.dot(FALLBACK_PLANE) < 0) {
      plane.multiplyScalar(-1);
    }
  }

  let zAxis = plane.clone().sub(yAxis.clone().multiplyScalar(plane.dot(yAxis)));
  if (zAxis.lengthSq() < PLANE_EPSILON && previousPlane) {
    zAxis = previousPlane.clone().sub(yAxis.clone().multiplyScalar(previousPlane.dot(yAxis)));
  }
  if (zAxis.lengthSq() < PLANE_EPSILON) {
    zAxis = FALLBACK_PLANE.clone().sub(
      yAxis.clone().multiplyScalar(FALLBACK_PLANE.dot(yAxis)),
    );
  }
  if (zAxis.lengthSq() < PLANE_EPSILON) {
    zAxis = new THREE.Vector3(0, 0, 1).sub(
      yAxis.clone().multiplyScalar(yAxis.z),
    );
  }
  zAxis.normalize();

  const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
  zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();

  return {
    quaternion: new THREE.Quaternion()
      .setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis))
      .normalize(),
    plane: plane.normalize(),
  };
}

// Use the toe as the stable X/Z contact locator whenever it exists. The v4
// probe switched between foot and toe based on which one was lower, which could
// create artificial X/Z velocity spikes. Y still uses the lower point.
export function stableGroundProbe(foot: THREE.Bone, toe?: THREE.Bone) {
  const footPosition = worldPosition(foot);
  if (!toe) return footPosition;
  const toePosition = worldPosition(toe);
  return new THREE.Vector3(
    toePosition.x,
    Math.min(footPosition.y, toePosition.y),
    toePosition.z,
  );
}

function solveOrientation(
  bones: BoneMap,
  reference: SolverReference,
  planes: PlaneMemory,
) {
  const bodyFrame = buildBodyFrame(bones);
  if (!bodyFrame) return null;

  const rootYaw = yawFromForward(bodyFrame.forward);
  const inverseBody = bodyFrame.quaternion.clone().invert();
  const inverseRoot = rootYaw.quaternion.clone().invert();

  const torsoQuaternion = clampLocalRotation(
    rootYaw.quaternion.clone().invert().multiply(bodyFrame.quaternion).normalize(),
    { x: 68, y: 74, z: 60 },
  );

  const leftArm = chainQuaternion(
    worldPosition(bones.leftUpperArm),
    worldPosition(bones.leftForeArm),
    worldPosition(bones.leftHand),
    inverseBody,
    planes.leftArm,
    { min: ARM_UPPER_WEIGHT_MIN, max: ARM_UPPER_WEIGHT_MAX, bendScale: Math.PI * 0.68 },
  );
  const rightArm = chainQuaternion(
    worldPosition(bones.rightUpperArm),
    worldPosition(bones.rightForeArm),
    worldPosition(bones.rightHand),
    inverseBody,
    planes.rightArm,
    { min: ARM_UPPER_WEIGHT_MIN, max: ARM_UPPER_WEIGHT_MAX, bendScale: Math.PI * 0.68 },
  );
  const leftLeg = chainQuaternion(
    worldPosition(bones.leftUpperLeg),
    worldPosition(bones.leftLowerLeg),
    worldPosition(bones.leftFoot),
    inverseRoot,
    planes.leftLeg,
    { min: LEG_UPPER_WEIGHT_MIN, max: LEG_UPPER_WEIGHT_MAX, bendScale: Math.PI * 0.72 },
  );
  const rightLeg = chainQuaternion(
    worldPosition(bones.rightUpperLeg),
    worldPosition(bones.rightLowerLeg),
    worldPosition(bones.rightFoot),
    inverseRoot,
    planes.rightLeg,
    { min: LEG_UPPER_WEIGHT_MIN, max: LEG_UPPER_WEIGHT_MAX, bendScale: Math.PI * 0.72 },
  );

  planes.leftArm = leftArm.plane?.clone() ?? planes.leftArm;
  planes.rightArm = rightArm.plane?.clone() ?? planes.rightArm;
  planes.leftLeg = leftLeg.plane?.clone() ?? planes.leftLeg;
  planes.rightLeg = rightLeg.plane?.clone() ?? planes.rightLeg;

  const headDirection = worldPosition(bones.head)
    .sub(worldPosition(bones.torso))
    .applyQuaternion(inverseBody);
  const headQuaternion = headDirection.lengthSq() < EPSILON
    ? new THREE.Quaternion()
    : clampLocalRotation(
        new THREE.Quaternion().setFromUnitVectors(UP, headDirection.normalize()),
        { x: 44, y: 45, z: 32 },
      );

  const leftProbe = stableGroundProbe(bones.leftFoot, bones.leftToe);
  const rightProbe = stableGroundProbe(bones.rightFoot, bones.rightToe);

  return {
    rootQuaternion: rootYaw.quaternion,
    torsoQuaternion,
    headQuaternion,
    leftArmQuaternion: leftArm.quaternion,
    rightArmQuaternion: rightArm.quaternion,
    leftLegQuaternion: leftLeg.quaternion,
    rightLegQuaternion: rightLeg.quaternion,
    leftProbe,
    rightProbe,
    hipsY: worldPosition(bones.hips).y,
    rootYawDeg: THREE.MathUtils.radToDeg(rootYaw.yaw),
    leftFootLift: leftProbe.y - reference.sourceGroundY,
    rightFootLift: rightProbe.y - reference.sourceGroundY,
  };
}

function stabilizeQuaternion(
  current: THREE.Quaternion,
  previous: THREE.Quaternion | null,
  maxDegrees: number,
) {
  const result = current.clone().normalize();
  if (!previous) return result;
  if (previous.dot(result) < 0) result.set(-result.x, -result.y, -result.z, -result.w);

  const angle = previous.angleTo(result);
  const maxAngle = THREE.MathUtils.degToRad(maxDegrees);
  if (angle > maxAngle && angle > EPSILON) {
    return previous.clone().slerp(result, maxAngle / angle).normalize();
  }
  return result;
}

export function smoothSpeeds(samples: ContactSample[]) {
  const left: number[] = [];
  const right: number[] = [];

  for (let index = 0; index < samples.length; index += 1) {
    const previous = samples[Math.max(0, index - 1)];
    const next = samples[Math.min(samples.length - 1, index + 1)];
    const dt = Math.max(next.time - previous.time, 1 / SAMPLE_FPS);
    left.push(next.leftProbe.distanceTo(previous.leftProbe) / dt);
    right.push(next.rightProbe.distanceTo(previous.rightProbe) / dt);
  }

  const median3 = (values: number[], index: number) => {
    const window = [
      values[Math.max(0, index - 1)],
      values[index],
      values[Math.min(values.length - 1, index + 1)],
    ].sort((a, b) => a - b);
    return window[1];
  };

  samples.forEach((sample, index) => {
    sample.leftFootSpeed = median3(left, index);
    sample.rightFootSpeed = median3(right, index);
  });
}

export function assignContactStates(samples: ContactSample[], reference: SolverReference) {
  let leftContact = false;
  let rightContact = false;
  let support: SupportSide = null;
  let pendingSupport: SupportSide = null;
  let pendingFrames = 0;
  let segmentId = 0;
  let lastSegmentSupport: SupportSide = null;

  for (const sample of samples) {
    const hipsLift = sample.hipsY - reference.sourceHipsBaseY;
    const airborne =
      sample.leftFootLift > FOOT_AIRBORNE_THRESHOLD &&
      sample.rightFootLift > FOOT_AIRBORNE_THRESHOLD &&
      hipsLift > HIP_AIRBORNE_THRESHOLD;

    if (airborne) {
      leftContact = false;
      rightContact = false;
      support = null;
      pendingSupport = null;
      pendingFrames = 0;
      sample.state = "airborne";
      sample.support = null;
      if (lastSegmentSupport !== null) segmentId += 1;
      lastSegmentSupport = null;
      sample.segmentId = segmentId;
      continue;
    }

    leftContact =
      sample.leftFootLift <= (leftContact ? CONTACT_EXIT_HEIGHT : CONTACT_ENTER_HEIGHT) &&
      sample.leftFootSpeed <= (leftContact ? CONTACT_EXIT_SPEED : CONTACT_ENTER_SPEED);
    rightContact =
      sample.rightFootLift <= (rightContact ? CONTACT_EXIT_HEIGHT : CONTACT_ENTER_HEIGHT) &&
      sample.rightFootSpeed <= (rightContact ? CONTACT_EXIT_SPEED : CONTACT_ENTER_SPEED);

    if (!leftContact && !rightContact) {
      if (support === "left" && sample.leftFootLift <= CONTACT_EXIT_HEIGHT + 0.12) {
        leftContact = true;
      } else if (support === "right" && sample.rightFootLift <= CONTACT_EXIT_HEIGHT + 0.12) {
        rightContact = true;
      } else if (sample.leftFootLift <= sample.rightFootLift) {
        leftContact = true;
      } else {
        rightContact = true;
      }
    }

    sample.state = leftContact && rightContact
      ? "double"
      : leftContact
        ? "left"
        : rightContact
          ? "right"
          : sample.leftFootLift <= sample.rightFootLift
            ? "left"
            : "right";

    let candidate: SupportSide;
    if (sample.state === "left" || sample.state === "right") {
      candidate = sample.state;
    } else {
      const liftDelta = sample.leftFootLift - sample.rightFootLift;
      if (support && Math.abs(liftDelta) < SUPPORT_SWITCH_MARGIN) {
        candidate = support;
      } else if (Math.abs(sample.leftFootSpeed - sample.rightFootSpeed) > 0.12) {
        candidate = sample.leftFootSpeed < sample.rightFootSpeed ? "left" : "right";
      } else {
        candidate = sample.leftFootLift <= sample.rightFootLift ? "left" : "right";
      }
    }

    if (support && candidate && candidate !== support) {
      const oldStillPlausible = support === "left"
        ? sample.leftFootLift <= CONTACT_EXIT_HEIGHT + 0.08
        : sample.rightFootLift <= CONTACT_EXIT_HEIGHT + 0.08;

      if (oldStillPlausible) {
        if (pendingSupport === candidate) pendingFrames += 1;
        else {
          pendingSupport = candidate;
          pendingFrames = 1;
        }
        if (pendingFrames < SUPPORT_SWITCH_FRAMES) candidate = support;
      }
    } else {
      pendingSupport = null;
      pendingFrames = 0;
    }

    if (candidate !== support) {
      support = candidate;
      pendingSupport = null;
      pendingFrames = 0;
    }

    sample.support = support;
    if (support !== lastSegmentSupport) {
      segmentId += 1;
      lastSegmentSupport = support;
    }
    sample.segmentId = segmentId;
  }
}

function endpointRelativeToRoot(
  rootQuaternion: THREE.Quaternion,
  legQuaternion: THREE.Quaternion,
  pivot: THREE.Vector3,
) {
  return pivot
    .clone()
    .add(DOWN.clone().multiplyScalar(R6_LIMB_LENGTH).applyQuaternion(legQuaternion))
    .applyQuaternion(rootQuaternion);
}

function limitRootXZ(position: THREE.Vector3, previous: THREE.Vector3 | null) {
  const result = position.clone();
  const flat = new THREE.Vector2(result.x, result.z);
  if (flat.length() > ROOT_XZ_LIMIT) {
    flat.setLength(ROOT_XZ_LIMIT);
    result.x = flat.x;
    result.z = flat.y;
  }

  if (previous) {
    const delta = new THREE.Vector2(result.x - previous.x, result.z - previous.z);
    if (delta.length() > ROOT_MAX_STEP) {
      delta.setLength(ROOT_MAX_STEP);
      result.x = previous.x + delta.x;
      result.z = previous.z + delta.y;
    }
  }
  return result;
}

function plantSupportLeg(
  rootQuaternion: THREE.Quaternion,
  rootGuess: THREE.Vector3,
  legQuaternion: THREE.Quaternion,
  pivot: THREE.Vector3,
  anchor: THREE.Vector3,
) {
  const root = rootGuess.clone();
  const pivotWorld = pivot.clone().applyQuaternion(rootQuaternion);

  let horizontal = new THREE.Vector2(
    anchor.x - (root.x + pivotWorld.x),
    anchor.z - (root.z + pivotWorld.z),
  );
  const maxHorizontal = R6_LIMB_LENGTH * 0.96;

  if (horizontal.length() > maxHorizontal) {
    const desired = horizontal.clone().setLength(maxHorizontal);
    root.x = anchor.x - pivotWorld.x - desired.x;
    root.z = anchor.z - pivotWorld.z - desired.y;
    horizontal = desired;
  }

  const verticalDrop = Math.sqrt(
    Math.max(R6_LIMB_LENGTH ** 2 - horizontal.lengthSq(), 0),
  );
  root.y = anchor.y + verticalDrop - pivotWorld.y;

  const hipWorld = root.clone().add(pivotWorld);
  const targetWorld = anchor.clone().sub(hipWorld);
  if (targetWorld.lengthSq() < EPSILON) {
    return { root, legQuaternion: legQuaternion.clone(), error: 0 };
  }
  targetWorld.normalize();

  const targetLocal = targetWorld.applyQuaternion(rootQuaternion.clone().invert()).normalize();
  const currentLocal = DOWN.clone().applyQuaternion(legQuaternion).normalize();
  const swingCorrection = new THREE.Quaternion()
    .setFromUnitVectors(currentLocal, targetLocal)
    .normalize();
  const plantedLeg = swingCorrection.multiply(legQuaternion.clone()).normalize();

  const endpoint = root.clone().add(endpointRelativeToRoot(rootQuaternion, plantedLeg, pivot));
  return {
    root,
    legQuaternion: plantedLeg,
    error: endpoint.distanceTo(anchor),
  };
}

function keepOtherFootAboveGround(
  root: THREE.Vector3,
  rootQuaternion: THREE.Quaternion,
  legQuaternion: THREE.Quaternion,
  pivot: THREE.Vector3,
) {
  const endpoint = root.clone().add(endpointRelativeToRoot(rootQuaternion, legQuaternion, pivot));
  if (endpoint.y >= -0.015) return legQuaternion;

  const pivotWorld = pivot.clone().applyQuaternion(rootQuaternion);
  const hipWorld = root.clone().add(pivotWorld);
  const horizontal = new THREE.Vector2(endpoint.x - hipWorld.x, endpoint.z - hipWorld.z);
  const maxHorizontal = R6_LIMB_LENGTH * 0.98;
  if (horizontal.length() > maxHorizontal) horizontal.setLength(maxHorizontal);

  const vertical = -Math.sqrt(
    Math.max(R6_LIMB_LENGTH ** 2 - horizontal.lengthSq(), 0),
  );
  const desiredWorld = new THREE.Vector3(horizontal.x, vertical, horizontal.y).normalize();
  const desiredLocal = desiredWorld.applyQuaternion(rootQuaternion.clone().invert()).normalize();
  const currentLocal = DOWN.clone().applyQuaternion(legQuaternion).normalize();
  return new THREE.Quaternion()
    .setFromUnitVectors(currentLocal, desiredLocal)
    .multiply(legQuaternion.clone())
    .normalize();
}

export function buildPoseTrack(
  mixer: THREE.AnimationMixer,
  sourceObject: THREE.Object3D,
  bones: BoneMap,
  reference: SolverReference,
  duration: number,
): PoseTrack {
  const frameCount = Math.max(2, Math.ceil(duration * SAMPLE_FPS) + 1);
  const raw: RawSample[] = [];
  const planes: PlaneMemory = {
    leftArm: null,
    rightArm: null,
    leftLeg: null,
    rightLeg: null,
  };

  for (let index = 0; index < frameCount; index += 1) {
    const time = Math.min(index / SAMPLE_FPS, duration);
    mixer.setTime(time);
    sourceObject.updateMatrixWorld(true);
    const solved = solveOrientation(bones, reference, planes);
    if (!solved) continue;

    raw.push({
      time,
      ...solved,
      leftFootSpeed: 0,
      rightFootSpeed: 0,
      state: "double",
      support: null,
      segmentId: 0,
    });
  }

  smoothSpeeds(raw);
  assignContactStates(raw, reference);

  const poses: PoseSample[] = [];
  let previousPose: PoseSample | null = null;
  let plantAnchor: THREE.Vector3 | null = null;
  let plantSegmentId = -1;

  for (const sample of raw) {
    const rootQuaternion = stabilizeQuaternion(
      sample.rootQuaternion,
      previousPose?.rootQuaternion ?? null,
      16,
    );
    const torsoQuaternion = stabilizeQuaternion(
      sample.torsoQuaternion,
      previousPose?.torsoQuaternion ?? null,
      22,
    );
    const headQuaternion = stabilizeQuaternion(
      sample.headQuaternion,
      previousPose?.headQuaternion ?? null,
      24,
    );
    const leftArmQuaternion = stabilizeQuaternion(
      sample.leftArmQuaternion,
      previousPose?.leftArmQuaternion ?? null,
      38,
    );
    const rightArmQuaternion = stabilizeQuaternion(
      sample.rightArmQuaternion,
      previousPose?.rightArmQuaternion ?? null,
      38,
    );
    let leftLegQuaternion = stabilizeQuaternion(
      sample.leftLegQuaternion,
      previousPose?.leftLegQuaternion ?? null,
      30,
    );
    let rightLegQuaternion = stabilizeQuaternion(
      sample.rightLegQuaternion,
      previousPose?.rightLegQuaternion ?? null,
      30,
    );

    let rootPosition = previousPose?.rootPosition.clone() ?? new THREE.Vector3();
    let plantError = 0;

    if (sample.support) {
      const supportPivot = sample.support === "left" ? LEFT_LEG_PIVOT : RIGHT_LEG_PIVOT;
      const supportLeg = sample.support === "left" ? leftLegQuaternion : rightLegQuaternion;
      const sourceEndpoint = endpointRelativeToRoot(rootQuaternion, supportLeg, supportPivot);

      if (!plantAnchor || plantSegmentId !== sample.segmentId) {
        plantAnchor = rootPosition.clone().add(sourceEndpoint);
        plantAnchor.y = 0;
        plantSegmentId = sample.segmentId;
      }

      const desiredRoot = limitRootXZ(
        plantAnchor.clone().sub(sourceEndpoint),
        previousPose?.rootPosition ?? null,
      );
      desiredRoot.y = rootPosition.y;

      const planted = plantSupportLeg(
        rootQuaternion,
        desiredRoot,
        supportLeg,
        supportPivot,
        plantAnchor,
      );
      rootPosition = planted.root;
      plantError = planted.error;

      if (sample.support === "left") {
        leftLegQuaternion = planted.legQuaternion;
        rightLegQuaternion = keepOtherFootAboveGround(
          rootPosition,
          rootQuaternion,
          rightLegQuaternion,
          RIGHT_LEG_PIVOT,
        );
      } else {
        rightLegQuaternion = planted.legQuaternion;
        leftLegQuaternion = keepOtherFootAboveGround(
          rootPosition,
          rootQuaternion,
          leftLegQuaternion,
          LEFT_LEG_PIVOT,
        );
      }
    } else {
      plantAnchor = null;
      plantSegmentId = -1;
      const leftEndpoint = endpointRelativeToRoot(rootQuaternion, leftLegQuaternion, LEFT_LEG_PIVOT);
      const rightEndpoint = endpointRelativeToRoot(rootQuaternion, rightLegQuaternion, RIGHT_LEG_PIVOT);
      const lowest = Math.min(leftEndpoint.y, rightEndpoint.y);
      const sourceLift = Math.min(sample.leftFootLift, sample.rightFootLift);
      const airborneLift = THREE.MathUtils.clamp(sourceLift * 0.62, 0, 1.7);
      rootPosition = new THREE.Vector3(
        (previousPose?.rootPosition.x ?? 0) * 0.96,
        THREE.MathUtils.clamp(-lowest + airborneLift, -2.25, 2.1),
        (previousPose?.rootPosition.z ?? 0) * 0.96,
      );
    }

    const pose: PoseSample = {
      time: sample.time,
      rootPosition,
      rootQuaternion,
      torsoQuaternion,
      headQuaternion,
      leftArmQuaternion,
      rightArmQuaternion,
      leftLegQuaternion,
      rightLegQuaternion,
      diagnostics: {
        state: sample.state,
        support: sample.support,
        rootY: rootPosition.y,
        rootXZ: Math.hypot(rootPosition.x, rootPosition.z),
        rootYawDeg: sample.rootYawDeg,
        leftFootLift: sample.leftFootLift,
        rightFootLift: sample.rightFootLift,
        leftFootSpeed: sample.leftFootSpeed,
        rightFootSpeed: sample.rightFootSpeed,
        plantError,
      },
    };

    poses.push(pose);
    previousPose = pose;
  }

  mixer.setTime(0);
  sourceObject.updateMatrixWorld(true);
  return { fps: SAMPLE_FPS, duration, samples: poses };
}
