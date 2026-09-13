"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

type Props = {
  projectId: string;
  sourceUrl: string;
};

type BoneMap = {
  hips: THREE.Bone;
  torso: THREE.Bone;
  head: THREE.Bone;
  leftArm: THREE.Bone;
  leftHand: THREE.Bone;
  rightArm: THREE.Bone;
  rightHand: THREE.Bone;
  leftLeg: THREE.Bone;
  leftFoot: THREE.Bone;
  rightLeg: THREE.Bone;
  rightFoot: THREE.Bone;
};

type BindPose = {
  hipsPosition: THREE.Vector3;
  torsoQuaternion: THREE.Quaternion;
  headQuaternion: THREE.Quaternion;
  leftArmDirection: THREE.Vector3;
  rightArmDirection: THREE.Vector3;
  leftLegDirection: THREE.Vector3;
  rightLegDirection: THREE.Vector3;
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
  const mapped = {
    hips: findBone(bones, "Hips"),
    torso: findBone(bones, "Spine2", "Spine1", "Spine"),
    head: findBone(bones, "Head"),
    leftArm: findBone(bones, "LeftArm"),
    leftHand: findBone(bones, "LeftHand", "LeftForeArm"),
    rightArm: findBone(bones, "RightArm"),
    rightHand: findBone(bones, "RightHand", "RightForeArm"),
    leftLeg: findBone(bones, "LeftUpLeg"),
    leftFoot: findBone(bones, "LeftFoot", "LeftLeg"),
    rightLeg: findBone(bones, "RightUpLeg"),
    rightFoot: findBone(bones, "RightFoot", "RightLeg"),
  };

  if (Object.values(mapped).some((bone) => !bone)) return null;
  return mapped as BoneMap;
}

function worldPosition(object: THREE.Object3D) {
  return object.getWorldPosition(new THREE.Vector3());
}

function worldQuaternion(object: THREE.Object3D) {
  return object.getWorldQuaternion(new THREE.Quaternion());
}

function directionBetween(from: THREE.Object3D, to: THREE.Object3D) {
  return worldPosition(to).sub(worldPosition(from)).normalize();
}

function captureBindPose(bones: BoneMap): BindPose {
  return {
    hipsPosition: worldPosition(bones.hips),
    torsoQuaternion: worldQuaternion(bones.torso),
    headQuaternion: worldQuaternion(bones.head),
    leftArmDirection: directionBetween(bones.leftArm, bones.leftHand),
    rightArmDirection: directionBetween(bones.rightArm, bones.rightHand),
    leftLegDirection: directionBetween(bones.leftLeg, bones.leftFoot),
    rightLegDirection: directionBetween(bones.rightLeg, bones.rightFoot),
  };
}

function relativeQuaternion(current: THREE.Quaternion, bind: THREE.Quaternion) {
  return current.clone().multiply(bind.clone().invert()).normalize();
}

function directionDelta(bind: THREE.Vector3, current: THREE.Vector3) {
  return new THREE.Quaternion().setFromUnitVectors(bind, current).normalize();
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

function applyR6Pose(rig: R6Rig, bones: BoneMap, bind: BindPose) {
  const torsoDelta = relativeQuaternion(
    worldQuaternion(bones.torso),
    bind.torsoQuaternion,
  );
  rig.torsoFrame.quaternion.copy(torsoDelta);

  const inverseTorso = torsoDelta.clone().invert();

  const headDelta = relativeQuaternion(
    worldQuaternion(bones.head),
    bind.headQuaternion,
  );
  rig.headPivot.quaternion.copy(inverseTorso.clone().multiply(headDelta));

  const leftArmWorld = directionDelta(
    bind.leftArmDirection,
    directionBetween(bones.leftArm, bones.leftHand),
  );
  rig.leftArmPivot.quaternion.copy(
    inverseTorso.clone().multiply(leftArmWorld),
  );

  const rightArmWorld = directionDelta(
    bind.rightArmDirection,
    directionBetween(bones.rightArm, bones.rightHand),
  );
  rig.rightArmPivot.quaternion.copy(
    inverseTorso.clone().multiply(rightArmWorld),
  );

  rig.leftLegPivot.quaternion.copy(
    directionDelta(
      bind.leftLegDirection,
      directionBetween(bones.leftLeg, bones.leftFoot),
    ),
  );
  rig.rightLegPivot.quaternion.copy(
    directionDelta(
      bind.rightLegDirection,
      directionBetween(bones.rightLeg, bones.rightFoot),
    ),
  );

  const hipsNow = worldPosition(bones.hips);
  rig.root.position.y = THREE.MathUtils.clamp(
    hipsNow.y - bind.hipsPosition.y,
    -1.5,
    3,
  );
}

function addSceneBasics(scene: THREE.Scene) {
  scene.background = new THREE.Color(0x0e1115);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x252a31, 1.8));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(4, 8, 5);
  scene.add(key);
  const grid = new THREE.GridHelper(18, 18, 0x313741, 0x20252c);
  scene.add(grid);
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

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
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

export function AnimationComparison({ projectId, sourceUrl }: Props) {
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
  const [clipName, setClipName] = useState<string>("Animation");

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
    let bind: BindPose | null = null;
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
        const action = mixer.clipAction(clip);
        action.play();
        mixer.setTime(0);
        sourceObject.updateMatrixWorld(true);

        bones = detectMixamoBones(sourceObject);
        if (!bones) {
          throw new Error(
            "Could not map the required Mixamo bones. Phase 1 currently expects a standard Mixamo humanoid skeleton.",
          );
        }

        bind = captureBindPose(bones);
        applyR6Pose(r6Rig, bones, bind);

        clipDuration = Math.max(clip.duration, 0.001);
        setDuration(clipDuration);
        setClipName(clip.name || "Animation");
        setLoading(false);

        void fetch(`/api/projects/${projectId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "preview_ready" }),
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

      if (mixer && sourceObject && bones && bind && clipDuration > 0) {
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
        applyR6Pose(r6Rig, bones, bind);

        if (now - lastUiUpdate > 50) {
          setTime(playback.current.time);
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
          <button type="button" onClick={() => setPlaying((value) => !value)} title="Play / Pause">
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
            disabled={!duration}
          />
          <div className="timecode">{formatTime(time)} / {formatTime(duration)}s</div>
          <button type="button" onClick={cycleSpeed}>{speed}×</button>
          <button type="button" onClick={() => setLoop((value) => !value)} title="Loop">
            {loop ? "Loop ✓" : "Loop"}
          </button>
        </div>
        <div className="transportMeta">
          <span>{clipName} · Smart R6 preview-v1</span>
          <span>Câmeras sincronizadas · Root Motion in-place</span>
        </div>
      </div>
    </section>
  );
}
