"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { exportComparisonGif } from "@/lib/exportComparisonGif";
import { exportComparisonWebm } from "@/lib/exportComparisonWebm";
import {
  SAMPLE_FPS,
  SOLVER_VERSION,
  applyPose,
  buildPoseTrack,
  createR6Rig,
  detectMixamoBones,
  fitSourceModel,
  measureSourceReference,
  type PoseTrack,
  type SolverDiagnostics,
} from "@/lib/r6SolverV4";

type Props = {
  projectId: string;
  sourceUrl: string;
};

type Viewport = ReturnType<typeof createViewport>;

function addSceneBasics(scene: THREE.Scene) {
  scene.background = new THREE.Color(0x0e1115);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x252a31, 1.8));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(4, 8, 5);
  scene.add(key);
  scene.add(new THREE.GridHelper(18, 18, 0x313741, 0x20252c));
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

function syncCamera(originalView: Viewport, r6View: Viewport) {
  r6View.camera.position.copy(originalView.camera.position);
  r6View.camera.quaternion.copy(originalView.camera.quaternion);
  r6View.camera.fov = originalView.camera.fov;
  r6View.camera.updateProjectionMatrix();
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "0.00";
  return seconds.toFixed(2);
}

export function AnimationComparisonV4({ projectId, sourceUrl }: Props) {
  const originalHost = useRef<HTMLDivElement>(null);
  const r6Host = useRef<HTMLDivElement>(null);
  const playback = useRef({ playing: true, speed: 1, loop: true, time: 0 });
  const renderExactFrame = useRef<((time: number) => void) | null>(null);

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
  const [exportingWebm, setExportingWebm] = useState(false);
  const [webmProgress, setWebmProgress] = useState(0);
  const [webmError, setWebmError] = useState<string | null>(null);
  const exportBusy = exportingGif || exportingWebm;

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
    let poseTrack: PoseTrack | null = null;
    let clipDuration = 0;
    let lastUiUpdate = 0;

    const originalView = createViewport(originalHost.current);
    const r6View = createViewport(r6Host.current);
    r6View.controls.enabled = false;

    const r6Rig = createR6Rig();
    r6View.scene.add(r6Rig.root);
    const clock = new THREE.Clock();

    function renderAtTime(nextTime: number) {
      if (!mixer || !sourceObject || !poseTrack) return null;

      const bounded = THREE.MathUtils.clamp(nextTime, 0, clipDuration);
      mixer.setTime(bounded);
      sourceObject.updateMatrixWorld(true);
      const frameDiagnostics = applyPose(r6Rig, poseTrack, bounded);

      originalView.controls.update();
      syncCamera(originalView, r6View);
      originalView.renderer.render(originalView.scene, originalView.camera);
      r6View.renderer.render(r6View.scene, r6View.camera);

      return frameDiagnostics;
    }

    async function load() {
      try {
        const loaded = await new FBXLoader().loadAsync(sourceUrl);
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

        const bones = detectMixamoBones(sourceObject);
        if (!bones) {
          throw new Error(
            "Could not map the required Mixamo arm/leg chain. Solver v4 expects the standard Mixamo humanoid skeleton.",
          );
        }

        clipDuration = Math.max(clip.duration, 0.001);
        const reference = measureSourceReference(mixer, sourceObject, bones, clipDuration);
        poseTrack = buildPoseTrack(mixer, sourceObject, bones, reference, clipDuration);

        if (poseTrack.samples.length < 2) {
          throw new Error("Solver v4 could not build a temporal pose track for this FBX.");
        }

        playback.current.time = 0;
        const initialDiagnostics = renderAtTime(0);
        setDiagnostics(initialDiagnostics);
        setDuration(clipDuration);
        setClipName(clip.name || "Animation");
        setLoading(false);

        renderExactFrame.current = (nextTime) => {
          const frameDiagnostics = renderAtTime(nextTime);
          if (frameDiagnostics) setDiagnostics(frameDiagnostics);
        };

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

      if (mixer && sourceObject && poseTrack && clipDuration > 0) {
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

        const frameDiagnostics = renderAtTime(playback.current.time);
        if (now - lastUiUpdate > 50) {
          setTime(playback.current.time);
          if (frameDiagnostics) setDiagnostics(frameDiagnostics);
          lastUiUpdate = now;
        }
      } else {
        originalView.controls.update();
        syncCamera(originalView, r6View);
        originalView.renderer.render(originalView.scene, originalView.camera);
        r6View.renderer.render(r6View.scene, r6View.camera);
      }
    }

    void load();
    frameId = requestAnimationFrame(render);

    return () => {
      cancelled = true;
      renderExactFrame.current = null;
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
    renderExactFrame.current?.(bounded);
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
    if (!originalCanvas || !r6Canvas || duration <= 0 || exportBusy) return;

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
          renderExactFrame.current?.(nextTime);
          await Promise.resolve();
        },
        onProgress: setGifProgress,
      });
    } catch (exportError) {
      setGifError(
        exportError instanceof Error ? exportError.message : "Falha ao gerar GIF",
      );
    } finally {
      playback.current.time = previous.time;
      renderExactFrame.current?.(previous.time);
      playback.current.playing = previous.playing;
      setTime(previous.time);
      setPlaying(previous.playing);
      setExportingGif(false);
    }
  }

  async function downloadDifferenceWebm() {
    const originalCanvas = originalHost.current?.querySelector("canvas");
    const r6Canvas = r6Host.current?.querySelector("canvas");
    if (!originalCanvas || !r6Canvas || duration <= 0 || exportBusy) return;

    const previous = {
      playing: playback.current.playing,
      time: playback.current.time,
    };

    setWebmError(null);
    setExportingWebm(true);
    setWebmProgress(0);
    playback.current.playing = false;
    setPlaying(false);

    try {
      await exportComparisonWebm({
        originalCanvas,
        r6Canvas,
        duration,
        clipName,
        solverVersion: SOLVER_VERSION,
        renderAt: async (nextTime) => {
          playback.current.time = nextTime;
          renderExactFrame.current?.(nextTime);
          await Promise.resolve();
        },
        onProgress: setWebmProgress,
      });
    } catch (exportError) {
      setWebmError(
        exportError instanceof Error ? exportError.message : "Falha ao gerar WebM",
      );
    } finally {
      playback.current.time = previous.time;
      renderExactFrame.current?.(previous.time);
      playback.current.playing = previous.playing;
      setTime(previous.time);
      setPlaying(previous.playing);
      setExportingWebm(false);
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
          {loading ? <div className="viewerMessage">Analisando clip a 30 FPS…</div> : null}
          {error ? <div className="viewerMessage">{error}</div> : null}
        </div>
        <div className="viewerPane">
          <div ref={r6Host} className="canvasHost" />
          {loading ? <div className="viewerMessage">Gerando pose track R6 v4…</div> : null}
          {error ? <div className="viewerMessage">Retarget indisponível</div> : null}
        </div>
      </div>

      <div className="transport">
        <div className="transportRow">
          <button type="button" onClick={() => seek(0)} title="Reiniciar" disabled={exportBusy}>↺</button>
          <button
            type="button"
            onClick={() => setPlaying((value) => !value)}
            title="Play / Pause"
            disabled={exportBusy}
          >
            {playing ? "Ⅱ" : "▶"}
          </button>
          <input
            className="timeline"
            type="range"
            min={0}
            max={Math.max(duration, 0.001)}
            step={1 / SAMPLE_FPS}
            value={Math.min(time, Math.max(duration, 0.001))}
            onChange={(event) => seek(Number(event.target.value))}
            disabled={!duration || exportBusy}
          />
          <div className="timecode">{formatTime(time)} / {formatTime(duration)}s</div>
          <button type="button" onClick={cycleSpeed} disabled={exportBusy}>{speed}×</button>
          <button
            type="button"
            onClick={() => setLoop((value) => !value)}
            title="Loop"
            disabled={exportBusy}
          >
            {loop ? "Loop ✓" : "Loop"}
          </button>
          <button
            type="button"
            className="gifExportButton"
            onClick={() => void downloadDifferenceGif()}
            disabled={loading || Boolean(error) || exportBusy || !duration}
            title="Gera um GIF sincronizado Original × R6 para comparar e reportar bugs"
          >
            {exportingGif
              ? `GIF ${Math.round(gifProgress * 100)}%`
              : "Baixar GIF comparação"}
          </button>
          <button
            type="button"
            className="gifExportButton"
            onClick={() => void downloadDifferenceWebm()}
            disabled={loading || Boolean(error) || exportBusy || !duration}
            title="Gera um WebM sincronizado Original × R6 em 30 FPS"
          >
            {exportingWebm
              ? `WebM ${Math.round(webmProgress * 100)}%`
              : "Baixar WebM comparação"}
          </button>
        </div>
        <div className="transportMeta">
          <span>{clipName} · Smart R6 {SOLVER_VERSION} · temporal {SAMPLE_FPS} FPS</span>
          <span>
            {diagnostics
              ? `State: ${diagnostics.state} · Lock: ${diagnostics.support ?? "none"} · Plant err ${diagnostics.plantError.toFixed(3)} · Root Y ${diagnostics.rootY.toFixed(2)} / XZ ${diagnostics.rootXZ.toFixed(2)} · L ${diagnostics.leftFootLift.toFixed(2)} / R ${diagnostics.rightFootLift.toFixed(2)}`
              : "Temporal pose track + XYZ foot plant + elbow/knee plane"}
          </span>
        </div>
        {gifError ? <div className="gifExportError">{gifError}</div> : null}
        {webmError ? <div className="gifExportError">{webmError}</div> : null}
      </div>
    </section>
  );
}
