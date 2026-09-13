type ExportComparisonWebmOptions = {
  originalCanvas: HTMLCanvasElement;
  r6Canvas: HTMLCanvasElement;
  duration: number;
  clipName: string;
  solverVersion: string;
  renderAt: (time: number) => Promise<void>;
  onProgress?: (progress: number) => void;
};

const WEBM_WIDTH = 1280;
const WEBM_HEIGHT = 480;
const HEADER_HEIGHT = 48;
const FOOTER_HEIGHT = 36;
const VIEW_HEIGHT = WEBM_HEIGHT - HEADER_HEIGHT - FOOTER_HEIGHT;
const HALF_WIDTH = WEBM_WIDTH / 2;
const WEBM_FPS = 30;
const VIDEO_BITRATE = 6_000_000;

function cleanFilename(value: string) {
  const cleaned = value
    .trim()
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "mixamo-r6-comparison";
}

function drawViewport(
  context: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  x: number,
) {
  const sourceRatio = source.width / Math.max(source.height, 1);
  const targetRatio = HALF_WIDTH / VIEW_HEIGHT;

  let sx = 0;
  let sy = 0;
  let sw = source.width;
  let sh = source.height;

  if (sourceRatio > targetRatio) {
    sw = source.height * targetRatio;
    sx = (source.width - sw) / 2;
  } else {
    sh = source.width / targetRatio;
    sy = (source.height - sh) / 2;
  }

  context.drawImage(
    source,
    sx,
    sy,
    sw,
    sh,
    x,
    HEADER_HEIGHT,
    HALF_WIDTH,
    VIEW_HEIGHT,
  );
}

function drawComparisonFrame(
  context: CanvasRenderingContext2D,
  originalCanvas: HTMLCanvasElement,
  r6Canvas: HTMLCanvasElement,
  clipName: string,
  solverVersion: string,
  time: number,
  duration: number,
) {
  context.fillStyle = "#0b0d10";
  context.fillRect(0, 0, WEBM_WIDTH, WEBM_HEIGHT);

  context.fillStyle = "#eef2ff";
  context.font = "600 16px system-ui, sans-serif";
  context.textBaseline = "middle";
  context.textAlign = "left";
  context.fillText("ORIGINAL · Mixamo FBX", 18, HEADER_HEIGHT / 2);
  context.fillText("CONVERTED · Roblox R6", HALF_WIDTH + 18, HEADER_HEIGHT / 2);

  drawViewport(context, originalCanvas, 0);
  drawViewport(context, r6Canvas, HALF_WIDTH);

  context.fillStyle = "#343b46";
  context.fillRect(HALF_WIDTH - 1, HEADER_HEIGHT, 2, VIEW_HEIGHT);
  context.fillRect(0, WEBM_HEIGHT - FOOTER_HEIGHT, WEBM_WIDTH, 1);

  context.fillStyle = "#a7b0bd";
  context.font = "13px system-ui, sans-serif";
  context.textAlign = "left";
  context.fillText(
    `${clipName} · ${solverVersion}`,
    18,
    WEBM_HEIGHT - FOOTER_HEIGHT / 2,
  );
  context.textAlign = "right";
  context.fillText(
    `${time.toFixed(2)}s / ${duration.toFixed(2)}s`,
    WEBM_WIDTH - 18,
    WEBM_HEIGHT - FOOTER_HEIGHT / 2,
  );
  context.textAlign = "left";
}

function supportedMimeType() {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? null;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function exportComparisonWebm({
  originalCanvas,
  r6Canvas,
  duration,
  clipName,
  solverVersion,
  renderAt,
  onProgress,
}: ExportComparisonWebmOptions) {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("Este navegador não suporta exportação WebM via MediaRecorder.");
  }

  const mimeType = supportedMimeType();
  if (!mimeType) {
    throw new Error("Nenhum codec WebM compatível foi encontrado neste navegador.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = WEBM_WIDTH;
  canvas.height = WEBM_HEIGHT;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create WebM drawing context");

  const stream = canvas.captureStream(WEBM_FPS);
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: VIDEO_BITRATE,
  });
  const chunks: BlobPart[] = [];

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });

  const stopped = new Promise<void>((resolve, reject) => {
    recorder.addEventListener("stop", () => resolve(), { once: true });
    recorder.addEventListener(
      "error",
      () => reject(new Error("MediaRecorder falhou durante a geração do WebM.")),
      { once: true },
    );
  });

  const frameCount = Math.max(2, Math.ceil(duration * WEBM_FPS) + 1);
  const frameDurationMs = 1000 / WEBM_FPS;

  recorder.start(250);

  try {
    for (let frame = 0; frame < frameCount; frame += 1) {
      const time = Math.min(frame / WEBM_FPS, duration);
      await renderAt(time);

      drawComparisonFrame(
        context,
        originalCanvas,
        r6Canvas,
        clipName,
        solverVersion,
        time,
        duration,
      );

      onProgress?.((frame + 1) / frameCount);

      // MediaRecorder timestamps are wall-clock based. Keeping one real-time
      // frame interval here gives the resulting WebM the expected clip speed.
      await sleep(frameDurationMs);
    }
  } finally {
    if (recorder.state !== "inactive") recorder.stop();
  }

  await stopped;
  stream.getTracks().forEach((track) => track.stop());

  if (chunks.length === 0) {
    throw new Error("O navegador não retornou dados para o WebM.");
  }

  const blob = new Blob(chunks, { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${cleanFilename(clipName)}-${solverVersion}-comparison.webm`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
