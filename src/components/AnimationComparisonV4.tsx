"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { exportComparisonGif } from "@/lib/exportComparisonGif";
import { exportComparisonWebm } from "@/lib/exportComparisonWebm";
import * as solverV41 from "@/lib/r6SolverV41";
import * as solverV5 from "@/lib/r6SolverV5";
import type { PoseTrack, SolverDiagnostics } from "@/lib/r6SolverV41";
import type { SolverDebugFrame } from "@/lib/r6SolverV5";
import { createR6DebugOverlay, createSourceLandmarkOverlay } from "@/lib/solverDebugOverlay";
import { downloadRbxmx, generateR6Rbxmx, sanitizeAnimationName } from "@/lib/exportR6Rbxmx";

type Props = {
  projectId: string;
  sourceUrl: string;
};

// v4.1 stays selectable so every WebM can be compared against the previous solver.
const SOLVERS = { "preview-v5": solverV5, "preview-v4.1": solverV41 } as const;
type SolverVersion = keyof typeof SOLVERS;
const SAMPLE_FPS = solverV5.SAMPLE_FPS;

type FrameInfo = { diagnostics: SolverDiagnostics | null; debug: SolverDebugFrame | null };

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

// Same orbit (orientation + offset) in both views; each view is centred on its
// own character so root motion never walks either one out of frame.
function syncCamera(originalView: Viewport, r6View: Viewport, r6Focus?: THREE.Vector3) {
  const offset = originalView.camera.position.clone().sub(originalView.controls.target);
  const focus = r6Focus
    ? new THREE.Vector3(r6Focus.x, originalView.controls.target.y, r6Focus.z)
    : originalView.controls.target;
  r6View.camera.position.copy(focus).add(offset);
  r6View.camera.quaternion.copy(originalView.camera.quaternion);
  r6View.camera.fov = originalView.camera.fov;
  r6View.camera.updateProjectionMatrix();
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "0.00";
  return seconds.toFixed(2);
}

function describeFrame({ diagnostics, debug }: FrameInfo) {
  if (!diagnostics) return "";
  const base = `State ${diagnostics.state} · Lock ${diagnostics.support ?? "none"} · Plant err ${diagnostics.plantError.toFixed(3)} · Root Y ${diagnostics.rootY.toFixed(2)} / XZ ${diagnostics.rootXZ.toFixed(2)} · Lift L ${diagnostics.leftFootLift.toFixed(2)} / R ${diagnostics.rightFootLift.toFixed(2)}`;
  if (!debug) return base;
  const { limbs } = debug;
  return `${base} · Err arm L ${limbs.leftArm.error.toFixed(2)} R ${limbs.rightArm.error.toFixed(2)} · leg L ${limbs.leftLeg.error.toFixed(2)} R ${limbs.rightLeg.error.toFixed(2)} · torso ${debug.torsoErrorDeg.toFixed(0)}° · total ${debug.totalError.toFixed(2)} · contact L ${debug.contactLevel.left.toFixed(2)} R ${debug.contactLevel.right.toFixed(2)}`;
}

export function AnimationComparisonV4({ projectId, sourceUrl }: Props) {
  const originalHost = useRef<HTMLDivElement>(null);
  const r6Host = useRef<HTMLDivElement>(null);
  const playback = useRef({ playing: true, speed: 1, loop: true, time: 0 });
  const renderExactFrame = useRef<((time: number) => void) | null>(null);
  const debugEnabled = useRef(false);
  const lastFrame = useRef<FrameInfo>({ diagnostics: null, debug: null });

  const [solverVersion, setSolverVersion] = useState<SolverVersion>("preview-v5");
  const [debugSolver, setDebugSolver] = useState(false);
  const [debugFrame, setDebugFrame] = useState<SolverDebugFrame | null>(null);
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
  const activeTrackRef = useRef<PoseTrack | null>(null);
  const [hasTrack, setHasTrack] = useState(false);
  const [rbxmxDownloaded, setRbxmxDownloaded] = useState(false);
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
    debugEnabled.current = debugSolver;
    renderExactFrame.current?.(playback.current.time);
  }, [debugSolver]);

  useEffect(() => {
    if (!originalHost.current || !r6Host.current) return;

    const solver = SOLVERS[solverVersion];
    let cancelled = false;
    let frameId = 0;
    let mixer: THREE.AnimationMixer | null = null;
    let sourceObject: THREE.Group | null = null;
    let poseTrack: PoseTrack | null = null;
    let sourceOverlay: ReturnType<typeof createSourceLandmarkOverlay> | null = null;
    let sourceHips: THREE.Bone | null = null;
    let clipDuration = 0;
    let lastUiUpdate = 0;

    setLoading(true);
    setError(null);

    const originalView = createViewport(originalHost.current);
    const r6View = createViewport(r6Host.current);
    r6View.controls.enabled = false;

    const r6Rig = solver.createR6Rig();
    r6View.scene.add(r6Rig.root);
    const r6Overlay = createR6DebugOverlay();
    r6View.scene.add(r6Overlay.group);
    const clock = new THREE.Clock();

    function renderAtTime(nextTime: number): FrameInfo | null {
      if (!mixer || !sourceObject || !poseTrack) return null;

      const bounded = THREE.MathUtils.clamp(nextTime, 0, clipDuration);
      // AnimationMixer wraps t === duration back to frame 0; show the last frame.
      mixer.setTime(Math.min(bounded, Math.max(0, clipDuration - 1e-3)));
      sourceObject.updateMatrixWorld(true);
      const frame: FrameInfo = {
        diagnostics: solver.applyPose(r6Rig, poseTrack, bounded),
        debug: "debugAt" in solver ? solver.debugAt(poseTrack, bounded) : null,
      };
      r6Overlay.update(debugEnabled.current ? frame.debug : null);
      sourceOverlay?.update(debugEnabled.current);
      lastFrame.current = frame;

      if (sourceHips) {
        const hips = sourceHips.getWorldPosition(new THREE.Vector3());
        const shift = new THREE.Vector3(
          hips.x - originalView.controls.target.x,
          0,
          hips.z - originalView.controls.target.z,
        );
        originalView.controls.target.add(shift);
        originalView.camera.position.add(shift);
      }
      originalView.controls.update();
      syncCamera(originalView, r6View, r6Rig.root.position);
      originalView.renderer.render(originalView.scene, originalView.camera);
      r6View.renderer.render(r6View.scene, r6View.camera);

      return frame;
    }

    function showFrame(frame: FrameInfo | null) {
      if (!frame) return;
      setDiagnostics(frame.diagnostics);
      setDebugFrame(frame.debug);
    }

    async function load() {
      try {
        const loaded = await new FBXLoader().loadAsync(sourceUrl);
        if (cancelled) return;

        sourceObject = loaded;
        solver.fitSourceModel(sourceObject);
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

        const bones = solver.detectMixamoBones(sourceObject);
        if (!bones) {
          throw new Error(
            "Could not map the required Mixamo arm/leg chain. The solver expects the standard Mixamo humanoid skeleton.",
          );
        }
        sourceOverlay = createSourceLandmarkOverlay(bones);
        originalView.scene.add(sourceOverlay.group);
        sourceHips = bones.hips;

        clipDuration = Math.max(clip.duration, 0.001);
        const reference = solver.measureSourceReference(mixer, sourceObject, bones, clipDuration);
        poseTrack = solver.buildPoseTrack(mixer, sourceObject, bones, reference, clipDuration);
        activeTrackRef.current = poseTrack;
        setHasTrack(true);

        if (poseTrack.samples.length < 2) {
          throw new Error(`${solver.SOLVER_VERSION} could not build a temporal pose track for this FBX.`);
        }

        // Keep the timestamp across solver switches so v4.1 × v5 compare 1:1.
        playback.current.time = Math.min(playback.current.time, clipDuration);
        showFrame(renderAtTime(playback.current.time));
        setTime(playback.current.time);
        setDuration(clipDuration);
        setClipName(clip.name || "Animation");
        setLoading(false);

        renderExactFrame.current = (nextTime) => showFrame(renderAtTime(nextTime));

        void fetch(`/api/projects/${projectId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "preview_ready", solverVersion: solver.SOLVER_VERSION }),
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

        const frame = renderAtTime(playback.current.time);
        if (now - lastUiUpdate > 50) {
          setTime(playback.current.time);
          showFrame(frame);
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
      activeTrackRef.current = null;
      setHasTrack(false);
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
  }, [projectId, sourceUrl, solverVersion]);

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
        solverVersion,
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
        solverVersion: debugSolver ? `${solverVersion} · debug` : solverVersion,
        renderAt: async (nextTime) => {
          playback.current.time = nextTime;
          renderExactFrame.current?.(nextTime);
          await Promise.resolve();
        },
        annotate: () => describeFrame(lastFrame.current),
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

  function downloadR6Rbxmx() {
    const track = activeTrackRef.current;
    if (!track || track.samples.length === 0) return;
    const safeClipName = sanitizeAnimationName(clipName || "Animation");
    const xml = generateR6Rbxmx(safeClipName, track.samples, loop);
    downloadRbxmx(`${safeClipName}_R6.rbxmx`, xml);
    setRbxmxDownloaded(true);
    window.setTimeout(() => setRbxmxDownloaded(false), 2500);
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
          {loading ? <div className="viewerMessage">Gerando pose track R6 {solverVersion}…</div> : null}
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
            className="rbxmxExportButton"
            onClick={downloadR6Rbxmx}
            disabled={loading || Boolean(error) || exportBusy || !hasTrack}
            title="Baixar a animação convertida em formato KeyframeSequence (.rbxmx) para Roblox Studio"
          >
            {rbxmxDownloaded ? "✓ R6 (.rbxmx) baixado!" : "Baixar R6 (.rbxmx)"}
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
          <button
            type="button"
            onClick={() => setSolverVersion((value) => (value === "preview-v5" ? "preview-v4.1" : "preview-v5"))}
            disabled={loading || exportBusy}
            title="Alterna entre o solver atual e o anterior no mesmo timestamp"
          >
            Solver: {solverVersion}
          </button>
          <button
            type="button"
            onClick={() => setDebugSolver((value) => !value)}
            disabled={exportBusy}
            aria-pressed={debugSolver}
            title="Landmarks Mixamo, alvos projetados, endpoints R6, contato e eixos do corpo"
          >
            {debugSolver ? "Debug Solver ✓" : "Debug Solver"}
          </button>
        </div>
        <div className="transportMeta">
          <span>{clipName} · Smart R6 {solverVersion} · temporal {SAMPLE_FPS} FPS</span>
          <span>
            {diagnostics
              ? describeFrame({ diagnostics, debug: debugSolver ? debugFrame : null })
              : "Pose fitting R6 + contato contínuo"}
          </span>
        </div>
        {debugSolver ? (
          <div className="transportMeta">
            <span>
              Mixamo: rosa = landmarks · R6: azul = alvos projetados (cotovelo/mão, joelho/tornozelo) · amarelo = endpoint R6 · vermelho = erro · roxo = alvo mão (espaço do corpo) · verde/laranja = alvo do pé de apoio/outro · eixos: vermelho right, verde up, azul forward
            </span>
          </div>
        ) : null}
        {gifError ? <div className="gifExportError">{gifError}</div> : null}
        {webmError ? <div className="gifExportError">{webmError}</div> : null}
      </div>
    </section>
  );
}
