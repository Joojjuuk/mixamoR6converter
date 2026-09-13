"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { exportComparisonGif } from "@/lib/exportComparisonGif";

type Props = {
  projectId: string;
  sourceUrl: string;
};

type BoneMap = {
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

type R6Rig = {
  root: THREE.Group;
  torsoFrame: THREE.Group;
  headPivot: THREE.Group;
  leftArmPivot: THREE.Group;
  rightArmPivot: THREE.Group;
  leftLegPivot: THREE.Group;
  rightLegPivot: THREE.Group;
};

type SolverReference = {
  sourceGroundY: number;
  sourceHipsBaseY: number;
};

type SolverDiagnostics = {
  support: "left" | "right" | "airborne";
  rootY: number;
  rootYawDeg: number;
  leftFootLift: number;
  rightFootLift: number;
};

type BodyFrame = {
  quaternion: THREE.Quaternion;
  forward: THREE.Vector3;
};

const SOLVER_VERSION = "preview-v3";
const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const EPSILON = 1e-6;
const R6_LIMB_LENGTH = 2;
const FOOT_AIRBORNE_THRESHOLD = 0.42;
const HIP_AIRBORNE_THRESHOLD = 0.18;

function normalizedBoneName(name: string) {
  return name
    .toLowerCase()
    .replace(/mixamorig/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function collectBones(object: THREE.Object3D) {
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

function detectMixamoBones(object: THREE.Object3D): BoneMap | null {
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

function directionBetween(from: THREE.Object3D, to: THREE.Object3D) {
  const direction = worldPosition(to).sub(worldPosition(from));
  if (direction.lengthSq() < EPSILON) return null;
  return direction.normalize();
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

function createR6Rig(): R6Rig {
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
  leftLegPivot.position.set(-0.5, 2, 0);
  leftLegPivot.add(makeBlock([1, 2, 1], [0, -1, 0]));
  root.add(leftLegPivot);

  const rightLegPivot = new THREE.Group();
  rightLegPivot.position.set(0.5, 2, 0);
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

function orientPivotFromDirection(
  pivot: THREE.Group,
  targetDirectionLocal: THREE.Vector3 | null,
) {
  if (!targetDirectionLocal || targetDirectionLocal.lengthSq() < EPSILON) return;
  pivot.quaternion
    .setFromUnitVectors(DOWN, targetDirectionLocal.clone().normalize())
    .normalize();
}

function blendedArmDirection(
  upperArm: THREE.Bone,
  foreArm: THREE.Bone,
  hand: THREE.Bone,
) {
  const upper = directionBetween(upperArm, foreArm);
  const lower = directionBetween(foreArm, hand);
  const reach = directionBetween(upperArm, hand);

  if (!upper) return reach;
  if (!reach) return upper;

  const bendAngle = lower ? upper.angleTo(lower) : 0;
  const bendFactor = THREE.MathUtils.clamp(bendAngle / (Math.PI * 0.75), 0, 1);
  const upperWeight = THREE.MathUtils.lerp(0.58, 0.9, bendFactor);

  return upper
    .clone()
    .multiplyScalar(upperWeight)
    .add(reach.clone().multiplyScalar(1 - upperWeight))
    .normalize();
}

function blendedLegDirection(
  upperLeg: THREE.Bone,
  lowerLeg: THREE.Bone,
  foot: THREE.Bone,
) {
  const upper = directionBetween(upperLeg, lowerLeg);
  const lower = directionBetween(lowerLeg, foot);
  const reach = directionBetween(upperLeg, foot);

  if (!reach) return upper;
  if (!upper) return reach;

  const bendAngle = lower ? upper.angleTo(lower) : 0;
  const bendFactor = THREE.MathUtils.clamp(bendAngle / (Math.PI * 0.7), 0, 1);
  const upperWeight = THREE.MathUtils.lerp(0.22, 0.48, bendFactor);

  return reach
    .clone()
    .multiplyScalar(1 - upperWeight)
    .add(upper.clone().multiplyScalar(upperWeight))
    .normalize();
}

function legEndpointY(pivot: THREE.Group) {
  const endpointOffset = DOWN.clone()
    .multiplyScalar(R6_LIMB_LENGTH)
    .applyQuaternion(pivot.quaternion);
  return pivot.position.y + endpointOffset.y;
}

function groundProbeY(foot: THREE.Bone, toe?: THREE.Bone) {
  const footY = worldPosition(foot).y;
  if (!toe) return footY;
  return Math.min(footY, worldPosition(toe).y);
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

function applyR6PoseV3(
  rig: R6Rig,
  bones: BoneMap,
  reference: SolverReference,
): SolverDiagnostics | null {
  const bodyFrame = buildBodyFrame(bones);
  if (!bodyFrame) return null;

  const rootYaw = yawFromForward(bodyFrame.forward);
  rig.root.quaternion.copy(rootYaw.quaternion);

  const torsoLocal = rootYaw.quaternion
    .clone()
    .invert()
    .multiply(bodyFrame.quaternion)
    .normalize();
  rig.torsoFrame.quaternion.copy(
    clampLocalRotation(torsoLocal, { x: 62, y: 70, z: 55 }),
  );

  const inverseBody = bodyFrame.quaternion.clone().invert();
  const inverseRootYaw = rootYaw.quaternion.clone().invert();

  const leftArmWorld = blendedArmDirection(
    bones.leftUpperArm,
    bones.leftForeArm,
    bones.leftHand,
  );
  const rightArmWorld = blendedArmDirection(
    bones.rightUpperArm,
    bones.rightForeArm,
    bones.rightHand,
  );

  orientPivotFromDirection(
    rig.leftArmPivot,
    leftArmWorld ? leftArmWorld.applyQuaternion(inverseBody) : null,
  );
  orientPivotFromDirection(
    rig.rightArmPivot,
    rightArmWorld ? rightArmWorld.applyQuaternion(inverseBody) : null,
  );

  const leftLegWorld = blendedLegDirection(
    bones.leftUpperLeg,
    bones.leftLowerLeg,
    bones.leftFoot,
  );
  const rightLegWorld = blendedLegDirection(
    bones.rightUpperLeg,
    bones.rightLowerLeg,
    bones.rightFoot,
  );

  orientPivotFromDirection(
    rig.leftLegPivot,
    leftLegWorld ? leftLegWorld.applyQuaternion(inverseRootYaw) : null,
  );
  orientPivotFromDirection(
    rig.rightLegPivot,
    rightLegWorld ? rightLegWorld.applyQuaternion(inverseRootYaw) : null,
  );

  const headWorld = directionBetween(bones.torso, bones.head);
  if (headWorld) {
    const headLocal = headWorld.applyQuaternion(inverseBody);
    const headRotation = new THREE.Quaternion()
      .setFromUnitVectors(UP, headLocal.normalize())
      .normalize();
    rig.headPivot.quaternion.copy(
      clampLocalRotation(headRotation, { x: 42, y: 45, z: 30 }),
    );
  }

  const leftProbeY = groundProbeY(bones.leftFoot, bones.leftToe);
  const rightProbeY = groundProbeY(bones.rightFoot, bones.rightToe);
  const leftFootLift = leftProbeY - reference.sourceGroundY;
  const rightFootLift = rightProbeY - reference.sourceGroundY;
  const hipsLift = worldPosition(bones.hips).y - reference.sourceHipsBaseY;

  // Conservative jump detection: ankle/toe motion alone must never classify a
  // melee pose as airborne. Both feet AND the hips need to rise together.
  const airborne =
    leftFootLift > FOOT_AIRBORNE_THRESHOLD &&
    rightFootLift > FOOT_AIRBORNE_THRESHOLD &&
    hipsLift > HIP_AIRBORNE_THRESHOLD;

  const leftTargetY = legEndpointY(rig.leftLegPivot);
  const rightTargetY = legEndpointY(rig.rightLegPivot);

  let support: SolverDiagnostics["support"];
  let rootY: number;

  if (airborne) {
    support = "airborne";
    const lowestTarget = Math.min(leftTargetY, rightTargetY);
    const sourceLift = Math.min(leftFootLift, rightFootLift);
    const airborneLift = THREE.MathUtils.clamp(sourceLift * 0.62, 0, 1.7);
    rootY = THREE.MathUtils.clamp(-lowestTarget + airborneLift, -2.25, 2.1);
  } else {
    support = leftProbeY <= rightProbeY ? "left" : "right";
    const supportEndpoint = support === "left" ? leftTargetY : rightTargetY;

    // Lock the same support side seen in the Mixamo source to y=0. This is more
    // stable than grounding whichever converted R6 leg happens to be lower.
    rootY = THREE.MathUtils.clamp(-supportEndpoint, -2.25, 1.0);
  }

  rig.root.position.set(0, rootY, 0);

  return {
    support,
    rootY,
    rootYawDeg: THREE.MathUtils.radToDeg(rootYaw.yaw),
    leftFootLift,
    rightFootLift,
  };
}

function measureSourceReference(
  mixer: THREE.AnimationMixer,
  sourceObject: THREE.Object3D,
  bones: BoneMap,
  duration: number,
): SolverReference {
  const sampleCount = THREE.MathUtils.clamp(Math.ceil(duration * 30), 30, 180);
  const groundSamples: number[] = [];
  const hipsSamples: number[] = [];

  for (let index = 0; index <= sampleCount; index += 1) {
    mixer.setTime((index / sampleCount) * duration);
    sourceObject.updateMatrixWorld(true);
    groundSamples.push(
      Math.min(
        groundProbeY(bones.leftFoot, bones.leftToe),
        groundProbeY(bones.rightFoot, bones.rightToe),
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

function addSceneBasics(scene: THREE.Scene) {
  scene.background = new THREE.Color(0x0e1115);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x252a31, 1.8));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(4, 8, 5);
  scene.add(key);
  scene.add(new THREE.GridHelper(18, 18, 0x313741, 0x20252c));
}

function fitSourceModel(object: THREE.Object3D) {
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

function createViewport(host: HTMLDivElement) {
  const scene = new THREE.Scene();
  addSceneBasics(scene);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
  camera.position.set(7, 5, 8);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 2.5, 0);
  controls.enableDamping = true;
  controls.update();

  const resize = () => {
    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  return { scene, camera, renderer, controls, observer };
}

function disposeScene(scene: THREE.Scene) {
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose?.();
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach((material) => material.dispose());
    } else {
      mesh.material?.dispose?.();
    }
  });
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "0.00";
  return seconds.toFixed(2);
}

function waitForTwoFrames() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export function AnimationComparisonV3({ projectId, sourceUrl }: Props) {
  const originalHost = useRef<HTMLDivElement>(null);
  const r6Host = useRef<HTMLDivElement>(null);
  const playback = useRef({ playing: true, speed: 1, loop: true, time: 0 });

  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clipName, setClipName] = useState("Animation");
  const [diagnostics, setDiagnostics] = useState<SolverDiagnostics | null>(null);
  const [exportingGif, setExportingGif] = useState(false);
  const [gifProgress, setGifProgress] = useState(0);
  const [gifError, setGifError] = useState<string | null>(null);

  useEffect(() => {
    playback.current.playing = playing;
  }, [playing]);
  useEffect(() => {
    playback.current.speed = speed;
  }, [speed]);
  useEffect(() => {
    playback.current.loop = loop;
  }, [loop]);

  useEffect(() => {
    if (!originalHost.current || !r6Host.current) return;

    let cancelled = false;
    let frameId = 0;
    let mixer: THREE.AnimationMixer | null = null;
    let sourceObject: THREE.Group | null = null;
    let bones: BoneMap | null = null;
    let reference: SolverReference | null = null;
    let clipDuration = 0;
    let lastUiUpdate = 0;

    const originalView = createViewport(originalHost.current);
    const r6View = createViewport(r6Host.current);
    r6View.controls.enabled = false;

    const r6Rig = createR6Rig();
    r6View.scene.add(r6Rig.root);
    const clock = new THREE.Clock();

    async function load() {
      try {
        const loader = new FBXLoader();
        const loaded = await loader.loadAsync(sourceUrl);
        if (cancelled) return;

        sourceObject = loaded;
        fitSourceModel(sourceObject);
        originalView.scene.add(sourceObject);

        const skeleton = new THREE.SkeletonHelper(sourceObject);
        const skeletonMaterial = skeleton.material as THREE.LineBasicMaterial;
        skeletonMaterial.transparent = true;
        skeletonMaterial.opacity = 0.45;
        originalView.scene.add(skeleton);

        const clip = sourceObject.animations[0];
        if (!clip) throw new Error("No animation clip was found inside this FBX.");

        mixer = new THREE.AnimationMixer(sourceObject);
        mixer.clipAction(clip).play();
        mixer.setTime(0);
        sourceObject.updateMatrixWorld(true);

        bones = detectMixamoBones(sourceObject);
        if (!bones) {
          throw new Error(
            "Could not map the required Mixamo arm/leg chain. Solver v3 expects the standard Mixamo humanoid skeleton.",
          );
        }

        clipDuration = Math.max(clip.duration, 0.001);
        reference = measureSourceReference(mixer, sourceObject, bones, clipDuration);

        mixer.setTime(0);
        sourceObject.updateMatrixWorld(true);
        setDiagnostics(applyR6PoseV3(r6Rig, bones, reference));
        setDuration(clipDuration);
        setClipName(clip.name || "Animation");
        setLoading(false);

        void fetch(`/api/projects/${projectId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "preview_ready", solverVersion: SOLVER_VERSION }),
        });
      } catch (loadError) {
        if (cancelled) return;
        setLoading(false);
        setError(loadError instanceof Error ? loadError.message : "Failed to load FBX");
      }
    }

    function render(now: number) {
      frameId = requestAnimationFrame(render);
      const delta = Math.min(clock.getDelta(), 0.1);

      if (mixer && sourceObject && bones && reference && clipDuration > 0) {
        if (playback.current.playing) {
          playback.current.time += delta * playback.current.speed;
          if (playback.current.time > clipDuration) {
            if (playback.current.loop) {
              playback.current.time %= clipDuration;
            } else {
              playback.current.time = clipDuration;
              playback.current.playing = false;
              setPlaying(false);
            }
          }
        }

        mixer.setTime(playback.current.time);
        sourceObject.updateMatrixWorld(true);
        const frameDiagnostics = applyR6PoseV3(r6Rig, bones, reference);

        if (now - lastUiUpdate > 50) {
          setTime(playback.current.time);
          if (frameDiagnostics) setDiagnostics(frameDiagnostics);
          lastUiUpdate = now;
        }
      }

      originalView.controls.update();
      r6View.camera.position.copy(originalView.camera.position);
      r6View.camera.quaternion.copy(originalView.camera.quaternion);
      r6View.camera.fov = originalView.camera.fov;
      r6View.camera.updateProjectionMatrix();

      originalView.renderer.render(originalView.scene, originalView.camera);
      r6View.renderer.render(r6View.scene, r6View.camera);
    }

    void load();
    frameId = requestAnimationFrame(render);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      originalView.observer.disconnect();
      r6View.observer.disconnect();
      originalView.controls.dispose();
      r6View.controls.dispose();
      originalView.renderer.dispose();
      r6View.renderer.dispose();
      disposeScene(originalView.scene);
      disposeScene(r6View.scene);
      originalView.renderer.domElement.remove();
      r6View.renderer.domElement.remove();
    };
  }, [projectId, sourceUrl]);

  function seek(nextTime: number) {
    const bounded = THREE.MathUtils.clamp(nextTime, 0, duration || 0);
    playback.current.time = bounded;
    setTime(bounded);
  }

  function cycleSpeed() {
    const speeds = [0.25, 0.5, 1, 1.5, 2];
    const index = speeds.indexOf(speed);
    setSpeed(speeds[(index + 1) % speeds.length]);
  }

  async function downloadDifferenceGif() {
    const originalCanvas = originalHost.current?.querySelector("canvas");
    const r6Canvas = r6Host.current?.querySelector("canvas");
    if (!originalCanvas || !r6Canvas || duration <= 0 || exportingGif) return;

    const previous = {
      playing: playback.current.playing,
      time: playback.current.time,
    };

    setGifError(null);
    setExportingGif(true);
    setGifProgress(0);
    playback.current.playing = false;
    setPlaying(false);

    try {
      await exportComparisonGif({
        originalCanvas,
        r6Canvas,
        duration,
        clipName,
        solverVersion: SOLVER_VERSION,
        renderAt: async (nextTime) => {
          playback.current.time = nextTime;
          await waitForTwoFrames();
        },
        onProgress: setGifProgress,
      });
    } catch (exportError) {
      setGifError(
        exportError instanceof Error ? exportError.message : "Falha ao gerar GIF",
      );
    } finally {
      playback.current.time = previous.time;
      playback.current.playing = previous.playing;
      setTime(previous.time);
      setPlaying(previous.playing);
      setExportingGif(false);
    }
  }

  return (
    <section className="panel comparisonWrap">
      <div className="viewerHeader">
        <div>ORIGINAL · Mixamo FBX</div>
        <div>CONVERTED PREVIEW · Roblox R6</div>
      </div>

      <div className="viewerGrid">
        <div className="viewerPane">
          <div ref={originalHost} className="canvasHost" />
          {loading ? <div className="viewerMessage">Carregando FBX…</div> : null}
          {error ? <div className="viewerMessage">{error}</div> : null}
        </div>
        <div className="viewerPane">
          <div ref={r6Host} className="canvasHost" />
          {loading ? <div className="viewerMessage">Preparando R6…</div> : null}
          {error ? <div className="viewerMessage">Retarget indisponível</div> : null}
        </div>
      </div>

      <div className="transport">
        <div className="transportRow">
          <button type="button" onClick={() => seek(0)} title="Reiniciar">↺</button>
          <button
            type="button"
            onClick={() => setPlaying((value) => !value)}
            title="Play / Pause"
          >
            {playing ? "Ⅱ" : "▶"}
          </button>
          <input
            className="timeline"
            type="range"
            min={0}
            max={Math.max(duration, 0.001)}
            step={1 / 30}
            value={Math.min(time, Math.max(duration, 0.001))}
            onChange={(event) => seek(Number(event.target.value))}
            disabled={!duration || exportingGif}
          />
          <div className="timecode">{formatTime(time)} / {formatTime(duration)}s</div>
          <button type="button" onClick={cycleSpeed} disabled={exportingGif}>{speed}×</button>
          <button
            type="button"
            onClick={() => setLoop((value) => !value)}
            title="Loop"
            disabled={exportingGif}
          >
            {loop ? "Loop ✓" : "Loop"}
          </button>
          <button
            type="button"
            className="gifExportButton"
            onClick={() => void downloadDifferenceGif()}
            disabled={loading || Boolean(error) || exportingGif || !duration}
            title="Gera um GIF sincronizado Original × R6 para comparar e reportar bugs"
          >
            {exportingGif
              ? `GIF ${Math.round(gifProgress * 100)}%`
              : "Baixar GIF comparação"}
          </button>
        </div>
        <div className="transportMeta">
          <span>{clipName} · Smart R6 {SOLVER_VERSION}</span>
          <span>
            {diagnostics
              ? `Support: ${diagnostics.support} · Root Y ${diagnostics.rootY.toFixed(2)} · L ${diagnostics.leftFootLift.toFixed(2)} / R ${diagnostics.rightFootLift.toFixed(2)} · Yaw ${diagnostics.rootYawDeg.toFixed(1)}°`
              : "Arm-chain solver + support-foot lock"}
          </span>
        </div>
        {gifError ? <div className="gifExportError">{gifError}</div> : null}
      </div>
    </section>
  );
}