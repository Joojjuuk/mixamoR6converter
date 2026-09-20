import * as THREE from "three";

export type BoneMap = {
  hips: THREE.Bone;
  torso: THREE.Bone;
  head: THREE.Bone;
  leftUpperArm: THREE.Bone;
  leftForeArm: THREE.Bone;
  leftHand: THREE.Bone;
  rightUpperArm: THREE.Bone;
  rightForeArm: THREE.Bone;
  rightHand: THREE.Bone;
  leftUpperLeg: THREE.Bone;
  leftLowerLeg: THREE.Bone;
  leftFoot: THREE.Bone;
  rightUpperLeg: THREE.Bone;
  rightLowerLeg: THREE.Bone;
  rightFoot: THREE.Bone;
  leftToe?: THREE.Bone;
  rightToe?: THREE.Bone;
};

export type R6Rig = {
  root: THREE.Group;
  torsoFrame: THREE.Group;
  headPivot: THREE.Group;
  leftArmPivot: THREE.Group;
  rightArmPivot: THREE.Group;
  leftLegPivot: THREE.Group;
  rightLegPivot: THREE.Group;
};

export type SolverReference = {
  sourceGroundY: number;
  sourceHipsBaseY: number;
};

export type ContactState = "left" | "right" | "double" | "airborne";
export type SupportSide = "left" | "right" | null;

export type SolverDiagnostics = {
  state: ContactState;
  support: SupportSide;
  rootY: number;
  rootXZ: number;
  rootYawDeg: number;
  leftFootLift: number;
  rightFootLift: number;
  leftFootSpeed: number;
  rightFootSpeed: number;
  plantError: number;
};

type BodyFrame = {
  quaternion: THREE.Quaternion;
  forward: THREE.Vector3;
};

type RawPoseSample = {
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

export type PoseSample = {
  time: number;
  rootPosition: THREE.Vector3;
  rootQuaternion: THREE.Quaternion;
  torsoQuaternion: THREE.Quaternion;
  headQuaternion: THREE.Quaternion;
  leftArmQuaternion: THREE.Quaternion;
  rightArmQuaternion: THREE.Quaternion;
  leftLegQuaternion: THREE.Quaternion;
  rightLegQuaternion: THREE.Quaternion;
  diagnostics: SolverDiagnostics;
};

export type PoseTrack = {
  fps: number;
  duration: number;
  samples: PoseSample[];
};

type SolvedOrientation = {
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
};

export const SOLVER_VERSION = "preview-v4";
export const SAMPLE_FPS = 30;

const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
const EPSILON = 1e-6;
const R6_LIMB_LENGTH = 2;
const LEFT_LEG_PIVOT = new THREE.Vector3(-0.5, 2, 0);
const RIGHT_LEG_PIVOT = new THREE.Vector3(0.5, 2, 0);

const FOOT_AIRBORNE_THRESHOLD = 0.44;
const HIP_AIRBORNE_THRESHOLD = 0.2;
const CONTACT_ENTER_HEIGHT = 0.2;
const CONTACT_EXIT_HEIGHT = 0.34;
const CONTACT_ENTER_SPEED = 1.25;
const CONTACT_EXIT_SPEED = 2.05;
const SUPPORT_SWITCH_FRAMES = 3;
const ROOT_XZ_LIMIT = 0.85;
const ROOT_MAX_STEP = 0.26;

function normalizedBoneName(name: string) {
  return name
    .toLowerCase()
    .replace(/mixamorig/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function collectBones(object: THREE.Object3D) {
  const bones: THREE.Bone[] = [];
  object.traverse((child) => {
    if ((child as THREE.Bone).isBone) bones.push(child as THREE.Bone);
  });
  return bones;
}

function findBone(bones: THREE.Bone[], ...aliases: string[]) {
  const normalizedAliases = aliases.map(normalizedBoneName);
  return (
    bones.find((bone) => normalizedAliases.includes(normalizedBoneName(bone.name))) ||
    bones.find((bone) =>
      normalizedAliases.some((alias) => normalizedBoneName(bone.name).endsWith(alias)),
    )
  );
}

export function detectMixamoBones(object: THREE.Object3D): BoneMap | null {
  const bones = collectBones(object);
  const required = {
    hips: findBone(bones, "Hips"),
    torso: findBone(bones, "Spine2", "Spine1", "Spine"),
    head: findBone(bones, "Head"),
    leftUpperArm: findBone(bones, "LeftArm"),
    leftForeArm: findBone(bones, "LeftForeArm"),
    leftHand: findBone(bones, "LeftHand"),
    rightUpperArm: findBone(bones, "RightArm"),
    rightForeArm: findBone(bones, "RightForeArm"),
    rightHand: findBone(bones, "RightHand"),
    leftUpperLeg: findBone(bones, "LeftUpLeg"),
    leftLowerLeg: findBone(bones, "LeftLeg"),
    leftFoot: findBone(bones, "LeftFoot"),
    rightUpperLeg: findBone(bones, "RightUpLeg"),
    rightLowerLeg: findBone(bones, "RightLeg"),
    rightFoot: findBone(bones, "RightFoot"),
  };

  if (Object.values(required).some((bone) => !bone)) return null;

  return {
    ...(required as Omit<BoneMap, "leftToe" | "rightToe">),
    leftToe: findBone(bones, "LeftToeBase", "LeftToe"),
    rightToe: findBone(bones, "RightToeBase", "RightToe"),
  };
}

function worldPosition(object: THREE.Object3D) {
  return object.getWorldPosition(new THREE.Vector3());
}

function direction(from: THREE.Vector3, to: THREE.Vector3) {
  const result = to.clone().sub(from);
  return result.lengthSq() < EPSILON ? null : result.normalize();
}

function makeBlock(size: [number, number, number], position: [number, number, number]) {
  const geometry = new THREE.BoxGeometry(...size);
  const material = new THREE.MeshStandardMaterial({
    color: 0xc8ced8,
    roughness: 0.72,
    metalness: 0.02,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  return mesh;
}

export function createR6Rig(): R6Rig {
  const root = new THREE.Group();
  root.name = "R6PreviewRoot";

  const torsoFrame = new THREE.Group();
  torsoFrame.position.set(0, 3, 0);
  torsoFrame.add(makeBlock([2, 2, 1], [0, 0, 0]));
  root.add(torsoFrame);

  const headPivot = new THREE.Group();
  headPivot.position.set(0, 1.05, 0);
  headPivot.add(makeBlock([1.65, 1.25, 1.25], [0, 0.65, 0]));
  torsoFrame.add(headPivot);

  const leftArmPivot = new THREE.Group();
  leftArmPivot.position.set(-1.5, 0.65, 0);
  leftArmPivot.add(makeBlock([1, 2, 1], [0, -1, 0]));
  torsoFrame.add(leftArmPivot);

  const rightArmPivot = new THREE.Group();
  rightArmPivot.position.set(1.5, 0.65, 0);
  rightArmPivot.add(makeBlock([1, 2, 1], [0, -1, 0]));
  torsoFrame.add(rightArmPivot);

  const leftLegPivot = new THREE.Group();
  leftLegPivot.position.copy(LEFT_LEG_PIVOT);
  leftLegPivot.add(makeBlock([1, 2, 1], [0, -1, 0]));
  root.add(leftLegPivot);

  const rightLegPivot = new THREE.Group();
  rightLegPivot.position.copy(RIGHT_LEG_PIVOT);
  rightLegPivot.add(makeBlock([1, 2, 1], [0, -1, 0]));
  root.add(rightLegPivot);

  return {
    root,
    torsoFrame,
    headPivot,
    leftArmPivot,
    rightArmPivot,
    leftLegPivot,
    rightLegPivot,
  };
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
  upperWeightMin: number,
  upperWeightMax: number,
  bendScale: number,
) {
  const upper = direction(first, middle);
  const lower = direction(middle, end);
  const reach = direction(first, end);

  if (!upper) return reach;
  if (!reach) return upper;

  const bendAngle = lower ? upper.angleTo(lower) : 0;
  const bendFactor = THREE.MathUtils.clamp(bendAngle / bendScale, 0, 1);
  const upperWeight = THREE.MathUtils.lerp(upperWeightMin, upperWeightMax, bendFactor);

  return upper
    .clone()
    .multiplyScalar(upperWeight)
    .add(reach.clone().multiplyScalar(1 - upperWeight))
    .normalize();
}

function quaternionFromChain(
  firstWorld: THREE.Vector3,
  middleWorld: THREE.Vector3,
  endWorld: THREE.Vector3,
  parentInverse: THREE.Quaternion,
  options: {
    upperWeightMin: number;
    upperWeightMax: number;
    bendScale: number;
    preferredPlane: THREE.Vector3;
  },
) {
  const targetWorld = blendedChainDirection(
    firstWorld,
    middleWorld,
    endWorld,
    options.upperWeightMin,
    options.upperWeightMax,
    options.bendScale,
  );
  if (!targetWorld) return new THREE.Quaternion();

  const upperLocal = middleWorld
    .clone()
    .sub(firstWorld)
    .applyQuaternion(parentInverse)
    .normalize();
  const lowerLocal = endWorld
    .clone()
    .sub(middleWorld)
    .applyQuaternion(parentInverse)
    .normalize();
  const targetLocal = targetWorld.clone().applyQuaternion(parentInverse).normalize();

  // Local +Y is the opposite of the R6 limb direction because the block hangs
  // down from its pivot. The bend plane supplies a second axis, which removes
  // the arbitrary roll left by setFromUnitVectors(direction-only).
  const yAxis = targetLocal.clone().multiplyScalar(-1).normalize();
  let planeNormal = new THREE.Vector3().crossVectors(upperLocal, lowerLocal);
  const preferred = options.preferredPlane.clone().normalize();

  if (planeNormal.lengthSq() < EPSILON) {
    planeNormal = preferred.clone();
  } else {
    planeNormal.normalize();
    if (planeNormal.dot(preferred) < 0) planeNormal.multiplyScalar(-1);
  }

  let zAxis = planeNormal.sub(yAxis.clone().multiplyScalar(planeNormal.dot(yAxis)));
  if (zAxis.lengthSq() < EPSILON) {
    zAxis = preferred.clone().sub(yAxis.clone().multiplyScalar(preferred.dot(yAxis)));
  }
  if (zAxis.lengthSq() < EPSILON) {
    zAxis = FORWARD.clone().sub(yAxis.clone().multiplyScalar(FORWARD.dot(yAxis)));
  }
  zAxis.normalize();

  const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
  zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();

  return new THREE.Quaternion()
    .setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis))
    .normalize();
}

function groundProbe(foot: THREE.Bone, toe?: THREE.Bone) {
  const footPosition = worldPosition(foot);
  if (!toe) return footPosition;
  const toePosition = worldPosition(toe);
  return toePosition.y <= footPosition.y ? toePosition : footPosition;
}

function percentile(values: number[], amount: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = THREE.MathUtils.clamp(
    Math.floor((sorted.length - 1) * amount),
    0,
    sorted.length - 1,
  );
  return sorted[index];
}

export function measureSourceReference(
  mixer: THREE.AnimationMixer,
  sourceObject: THREE.Object3D,
  bones: BoneMap,
  duration: number,
): SolverReference {
  const sampleCount = THREE.MathUtils.clamp(Math.ceil(duration * SAMPLE_FPS), 30, 240);
  const groundSamples: number[] = [];
  const hipsSamples: number[] = [];

  for (let index = 0; index <= sampleCount; index += 1) {
    mixer.setTime((index / sampleCount) * duration);
    sourceObject.updateMatrixWorld(true);
    groundSamples.push(
      Math.min(
        groundProbe(bones.leftFoot, bones.leftToe).y,
        groundProbe(bones.rightFoot, bones.rightToe).y,
      ),
    );
    hipsSamples.push(worldPosition(bones.hips).y);
  }

  mixer.setTime(0);
  sourceObject.updateMatrixWorld(true);

  return {
    sourceGroundY: percentile(groundSamples, 0.08),
    sourceHipsBaseY: percentile(hipsSamples, 0.12),
  };
}

function solveOrientation(bones: BoneMap, reference: SolverReference): SolvedOrientation | null {
  const bodyFrame = buildBodyFrame(bones);
  if (!bodyFrame) return null;

  const rootYaw = yawFromForward(bodyFrame.forward);
  const inverseBody = bodyFrame.quaternion.clone().invert();
  const inverseRoot = rootYaw.quaternion.clone().invert();

  const torsoQuaternion = clampLocalRotation(
    rootYaw.quaternion.clone().invert().multiply(bodyFrame.quaternion).normalize(),
    { x: 62, y: 70, z: 55 },
  );

  const leftShoulder = worldPosition(bones.leftUpperArm);
  const leftElbow = worldPosition(bones.leftForeArm);
  const leftHand = worldPosition(bones.leftHand);
  const rightShoulder = worldPosition(bones.rightUpperArm);
  const rightElbow = worldPosition(bones.rightForeArm);
  const rightHand = worldPosition(bones.rightHand);
  const leftHip = worldPosition(bones.leftUpperLeg);
  const leftKnee = worldPosition(bones.leftLowerLeg);
  const leftFoot = worldPosition(bones.leftFoot);
  const rightHip = worldPosition(bones.rightUpperLeg);
  const rightKnee = worldPosition(bones.rightLowerLeg);
  const rightFoot = worldPosition(bones.rightFoot);

  const leftArmQuaternion = quaternionFromChain(
    leftShoulder,
    leftElbow,
    leftHand,
    inverseBody,
    {
      upperWeightMin: 0.62,
      upperWeightMax: 0.93,
      bendScale: Math.PI * 0.72,
      preferredPlane: FORWARD,
    },
  );
  const rightArmQuaternion = quaternionFromChain(
    rightShoulder,
    rightElbow,
    rightHand,
    inverseBody,
    {
      upperWeightMin: 0.62,
      upperWeightMax: 0.93,
      bendScale: Math.PI * 0.72,
      preferredPlane: FORWARD,
    },
  );
  const leftLegQuaternion = quaternionFromChain(
    leftHip,
    leftKnee,
    leftFoot,
    inverseRoot,
    {
      upperWeightMin: 0.2,
      upperWeightMax: 0.5,
      bendScale: Math.PI * 0.68,
      preferredPlane: FORWARD,
    },
  );
  const rightLegQuaternion = quaternionFromChain(
    rightHip,
    rightKnee,
    rightFoot,
    inverseRoot,
    {
      upperWeightMin: 0.2,
      upperWeightMax: 0.5,
      bendScale: Math.PI * 0.68,
      preferredPlane: FORWARD,
    },
  );

  const headDirection = worldPosition(bones.head)
    .sub(worldPosition(bones.torso))
    .applyQuaternion(inverseBody);
  const headQuaternion = headDirection.lengthSq() < EPSILON
    ? new THREE.Quaternion()
    : clampLocalRotation(
        new THREE.Quaternion().setFromUnitVectors(UP, headDirection.normalize()),
        { x: 42, y: 45, z: 30 },
      );

  const leftProbe = groundProbe(bones.leftFoot, bones.leftToe);
  const rightProbe = groundProbe(bones.rightFoot, bones.rightToe);

  return {
    rootQuaternion: rootYaw.quaternion,
    torsoQuaternion,
    headQuaternion,
    leftArmQuaternion,
    rightArmQuaternion,
    leftLegQuaternion,
    rightLegQuaternion,
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

  if (previous.dot(result) < 0) {
    result.set(-result.x, -result.y, -result.z, -result.w);
  }

  const angle = previous.angleTo(result);
  const maxAngle = THREE.MathUtils.degToRad(maxDegrees);
  if (angle > maxAngle && angle > EPSILON) {
    return previous.clone().slerp(result, maxAngle / angle).normalize();
  }
  return result;
}

function endpointRelativeToRoot(
  rootQuaternion: THREE.Quaternion,
  legQuaternion: THREE.Quaternion,
  pivot: THREE.Vector3,
) {
  const endpointLocal = pivot
    .clone()
    .add(DOWN.clone().multiplyScalar(R6_LIMB_LENGTH).applyQuaternion(legQuaternion));
  return endpointLocal.applyQuaternion(rootQuaternion);
}

function clampRootXZ(position: THREE.Vector3) {
  const flat = new THREE.Vector2(position.x, position.z);
  if (flat.length() > ROOT_XZ_LIMIT) {
    flat.setLength(ROOT_XZ_LIMIT);
    position.x = flat.x;
    position.z = flat.y;
  }
  return position;
}

function clampRootStep(target: THREE.Vector3, previous: THREE.Vector3 | null) {
  if (!previous) return target;

  // Ground contact owns Y. Only cap horizontal correction so the support foot
  // can stay exactly on the floor while X/Z corrections remain bounded.
  const horizontalDelta = new THREE.Vector2(
    target.x - previous.x,
    target.z - previous.z,
  );
  if (horizontalDelta.length() <= ROOT_MAX_STEP) return target;

  horizontalDelta.setLength(ROOT_MAX_STEP);
  return new THREE.Vector3(
    previous.x + horizontalDelta.x,
    target.y,
    previous.z + horizontalDelta.y,
  );
}

function assignContactStates(samples: RawPoseSample[], reference: SolverReference) {
  let leftContact = false;
  let rightContact = false;
  let previousSupport: SupportSide = null;
  let pendingSupport: SupportSide = null;
  let pendingFrames = 0;
  let segmentId = 0;
  let previousSegmentSupport: SupportSide = null;

  for (const sample of samples) {
    const hipsLift = sample.hipsY - reference.sourceHipsBaseY;
    const airborne =
      sample.leftFootLift > FOOT_AIRBORNE_THRESHOLD &&
      sample.rightFootLift > FOOT_AIRBORNE_THRESHOLD &&
      hipsLift > HIP_AIRBORNE_THRESHOLD;

    if (airborne) {
      leftContact = false;
      rightContact = false;
      sample.state = "airborne";
      sample.support = null;
      pendingSupport = null;
      pendingFrames = 0;
      if (previousSegmentSupport !== null) segmentId += 1;
      previousSegmentSupport = null;
      sample.segmentId = segmentId;
      previousSupport = null;
      continue;
    }

    leftContact =
      sample.leftFootLift <= (leftContact ? CONTACT_EXIT_HEIGHT : CONTACT_ENTER_HEIGHT) &&
      sample.leftFootSpeed <= (leftContact ? CONTACT_EXIT_SPEED : CONTACT_ENTER_SPEED);
    rightContact =
      sample.rightFootLift <= (rightContact ? CONTACT_EXIT_HEIGHT : CONTACT_ENTER_HEIGHT) &&
      sample.rightFootSpeed <= (rightContact ? CONTACT_EXIT_SPEED : CONTACT_ENTER_SPEED);

    if (!leftContact && !rightContact) {
      if (Math.min(sample.leftFootLift, sample.rightFootLift) <= CONTACT_EXIT_HEIGHT + 0.12) {
        if (sample.leftFootLift <= sample.rightFootLift) leftContact = true;
        else rightContact = true;
      } else if (previousSupport === "left") {
        leftContact = true;
      } else if (previousSupport === "right") {
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

    let desiredSupport: SupportSide;
    if (sample.state === "left" || sample.state === "right") {
      desiredSupport = sample.state;
    } else if (sample.state === "double") {
      if (previousSupport && (previousSupport === "left" ? leftContact : rightContact)) {
        desiredSupport = previousSupport;
      } else if (Math.abs(sample.leftFootSpeed - sample.rightFootSpeed) > 0.08) {
        desiredSupport = sample.leftFootSpeed < sample.rightFootSpeed ? "left" : "right";
      } else {
        desiredSupport = sample.leftFootLift <= sample.rightFootLift ? "left" : "right";
      }
    } else {
      desiredSupport = null;
    }

    if (
      previousSupport &&
      desiredSupport &&
      desiredSupport !== previousSupport &&
      (previousSupport === "left" ? leftContact : rightContact)
    ) {
      if (pendingSupport === desiredSupport) pendingFrames += 1;
      else {
        pendingSupport = desiredSupport;
        pendingFrames = 1;
      }

      if (pendingFrames < SUPPORT_SWITCH_FRAMES) {
        desiredSupport = previousSupport;
      } else {
        pendingSupport = null;
        pendingFrames = 0;
      }
    } else {
      pendingSupport = null;
      pendingFrames = 0;
    }

    sample.support = desiredSupport;
    if (desiredSupport !== previousSegmentSupport) {
      segmentId += 1;
      previousSegmentSupport = desiredSupport;
    }
    sample.segmentId = segmentId;
    previousSupport = desiredSupport;
  }
}

export function buildPoseTrack(
  mixer: THREE.AnimationMixer,
  sourceObject: THREE.Object3D,
  bones: BoneMap,
  reference: SolverReference,
  duration: number,
): PoseTrack {
  const frameCount = Math.max(2, Math.ceil(duration * SAMPLE_FPS) + 1);
  const raw: RawPoseSample[] = [];

  for (let index = 0; index < frameCount; index += 1) {
    const time = Math.min(index / SAMPLE_FPS, duration);
    mixer.setTime(time);
    sourceObject.updateMatrixWorld(true);
    const solved = solveOrientation(bones, reference);
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

  for (let index = 0; index < raw.length; index += 1) {
    const previous = raw[Math.max(0, index - 1)];
    const next = raw[Math.min(raw.length - 1, index + 1)];
    const dt = Math.max(next.time - previous.time, 1 / SAMPLE_FPS);
    raw[index].leftFootSpeed = next.leftProbe.distanceTo(previous.leftProbe) / dt;
    raw[index].rightFootSpeed = next.rightProbe.distanceTo(previous.rightProbe) / dt;
  }

  assignContactStates(raw, reference);

  const poses: PoseSample[] = [];
  let previousPose: PoseSample | null = null;
  let plantAnchor: THREE.Vector3 | null = null;
  let plantSegmentId = -1;

  for (const sample of raw) {
    const rootQuaternion = stabilizeQuaternion(
      sample.rootQuaternion,
      previousPose?.rootQuaternion ?? null,
      20,
    );
    const torsoQuaternion = stabilizeQuaternion(
      sample.torsoQuaternion,
      previousPose?.torsoQuaternion ?? null,
      24,
    );
    const headQuaternion = stabilizeQuaternion(
      sample.headQuaternion,
      previousPose?.headQuaternion ?? null,
      28,
    );
    const leftArmQuaternion = stabilizeQuaternion(
      sample.leftArmQuaternion,
      previousPose?.leftArmQuaternion ?? null,
      45,
    );
    const rightArmQuaternion = stabilizeQuaternion(
      sample.rightArmQuaternion,
      previousPose?.rightArmQuaternion ?? null,
      45,
    );
    const leftLegQuaternion = stabilizeQuaternion(
      sample.leftLegQuaternion,
      previousPose?.leftLegQuaternion ?? null,
      35,
    );
    const rightLegQuaternion = stabilizeQuaternion(
      sample.rightLegQuaternion,
      previousPose?.rightLegQuaternion ?? null,
      35,
    );

    const leftEndpoint = endpointRelativeToRoot(
      rootQuaternion,
      leftLegQuaternion,
      LEFT_LEG_PIVOT,
    );
    const rightEndpoint = endpointRelativeToRoot(
      rootQuaternion,
      rightLegQuaternion,
      RIGHT_LEG_PIVOT,
    );

    let targetRoot: THREE.Vector3;
    let plantError = 0;

    if (sample.support) {
      const supportEndpoint = sample.support === "left" ? leftEndpoint : rightEndpoint;
      const previousRoot = previousPose?.rootPosition ?? new THREE.Vector3();

      if (plantSegmentId !== sample.segmentId || !plantAnchor) {
        plantAnchor = previousRoot.clone().add(supportEndpoint);
        plantAnchor.y = 0;
        plantSegmentId = sample.segmentId;
      }

      targetRoot = plantAnchor.clone().sub(supportEndpoint);
      targetRoot.y = THREE.MathUtils.clamp(targetRoot.y, -2.25, 1.2);
      clampRootXZ(targetRoot);
      targetRoot = clampRootStep(targetRoot, previousPose?.rootPosition ?? null);

      const plantedEndpoint = targetRoot.clone().add(supportEndpoint);
      plantError = plantedEndpoint.distanceTo(plantAnchor);
    } else {
      plantAnchor = null;
      plantSegmentId = -1;
      const lowestEndpointY = Math.min(leftEndpoint.y, rightEndpoint.y);
      const sourceLift = Math.min(sample.leftFootLift, sample.rightFootLift);
      const airborneLift = THREE.MathUtils.clamp(sourceLift * 0.62, 0, 1.7);
      targetRoot = new THREE.Vector3(
        (previousPose?.rootPosition.x ?? 0) * 0.97,
        THREE.MathUtils.clamp(-lowestEndpointY + airborneLift, -2.25, 2.1),
        (previousPose?.rootPosition.z ?? 0) * 0.97,
      );
      targetRoot = clampRootStep(targetRoot, previousPose?.rootPosition ?? null);
    }

    const pose: PoseSample = {
      time: sample.time,
      rootPosition: targetRoot,
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
        rootY: targetRoot.y,
        rootXZ: Math.hypot(targetRoot.x, targetRoot.z),
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

export function applyPose(rig: R6Rig, track: PoseTrack, time: number): SolverDiagnostics | null {
  if (track.samples.length === 0) return null;

  const exactIndex = THREE.MathUtils.clamp(time * track.fps, 0, track.samples.length - 1);
  const lowerIndex = Math.floor(exactIndex);
  const upperIndex = Math.min(lowerIndex + 1, track.samples.length - 1);
  const alpha = exactIndex - lowerIndex;
  const lower = track.samples[lowerIndex];
  const upper = track.samples[upperIndex];

  rig.root.position.copy(lower.rootPosition).lerp(upper.rootPosition, alpha);
  rig.root.quaternion.copy(lower.rootQuaternion).slerp(upper.rootQuaternion, alpha);
  rig.torsoFrame.quaternion.copy(lower.torsoQuaternion).slerp(upper.torsoQuaternion, alpha);
  rig.headPivot.quaternion.copy(lower.headQuaternion).slerp(upper.headQuaternion, alpha);
  rig.leftArmPivot.quaternion.copy(lower.leftArmQuaternion).slerp(upper.leftArmQuaternion, alpha);
  rig.rightArmPivot.quaternion.copy(lower.rightArmQuaternion).slerp(upper.rightArmQuaternion, alpha);
  rig.leftLegPivot.quaternion.copy(lower.leftLegQuaternion).slerp(upper.leftLegQuaternion, alpha);
  rig.rightLegPivot.quaternion.copy(lower.rightLegQuaternion).slerp(upper.rightLegQuaternion, alpha);

  return alpha < 0.5 ? lower.diagnostics : upper.diagnostics;
}

export function fitSourceModel(object: THREE.Object3D) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);

  if (box.isEmpty()) {
    const boneBox = new THREE.Box3();
    collectBones(object).forEach((bone) => boneBox.expandByPoint(worldPosition(bone)));
    if (!boneBox.isEmpty()) box.copy(boneBox);
  }

  if (box.isEmpty()) return;

  const size = box.getSize(new THREE.Vector3());
  const scale = 4.8 / Math.max(size.y, 0.001);
  object.scale.multiplyScalar(scale);
  object.updateMatrixWorld(true);

  const fitted = new THREE.Box3().setFromObject(object);
  if (fitted.isEmpty()) return;
  const center = fitted.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= fitted.min.y;
  object.updateMatrixWorld(true);
}
