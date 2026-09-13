import { GIFEncoder, applyPalette, quantize } from "gifenc";

type ExportComparisonGifOptions = {
  originalCanvas: HTMLCanvasElement;
  r6Canvas: HTMLCanvasElement;
  duration: number;
  clipName: string;
  solverVersion: string;
  renderAt: (time: number) => Promise<void>;
  onProgress?: (progress: number) => void;
};

const GIF_WIDTH = 960;
const GIF_HEIGHT = 360;
const HEADER_HEIGHT = 38;
const FOOTER_HEIGHT = 28;
const VIEW_HEIGHT = GIF_HEIGHT - HEADER_HEIGHT - FOOTER_HEIGHT;
const HALF_WIDTH = GIF_WIDTH / 2;
const TARGET_GIF_FPS = 10;
const MAX_GIF_FRAMES = 120;

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

export async function exportComparisonGif({
  originalCanvas,
  r6Canvas,
  duration,
  clipName,
  solverVersion,
  renderAt,
  onProgress,
}: ExportComparisonGifOptions) {
  const canvas = document.createElement("canvas");
  canvas.width = GIF_WIDTH;
  canvas.height = GIF_HEIGHT;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Could not create GIF drawing context");

  const gif = GIFEncoder();
  const idealFrameCount = Math.ceil(duration * TARGET_GIF_FPS) + 1;
  const frameCount = THREEClamp(idealFrameCount, 2, MAX_GIF_FRAMES);
  const frameDelay = Math.max(
    20,
    Math.round((duration / Math.max(frameCount - 1, 1)) * 1000),
  );

  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = Math.min((frame / (frameCount - 1)) * duration, duration);
    await renderAt(time);

    context.fillStyle = "#0b0d10";
    context.fillRect(0, 0, GIF_WIDTH, GIF_HEIGHT);

    context.fillStyle = "#eef2ff";
    context.font = "600 13px system-ui, sans-serif";
    context.textBaseline = "middle";
    context.fillText("ORIGINAL · Mixamo FBX", 14, HEADER_HEIGHT / 2);
    context.fillText("CONVERTED · Roblox R6", HALF_WIDTH + 14, HEADER_HEIGHT / 2);

    drawViewport(context, originalCanvas, 0);
    drawViewport(context, r6Canvas, HALF_WIDTH);

    context.fillStyle = "#323844";
    context.fillRect(HALF_WIDTH - 1, HEADER_HEIGHT, 2, VIEW_HEIGHT);
    context.fillRect(0, GIF_HEIGHT - FOOTER_HEIGHT, GIF_WIDTH, 1);

    context.fillStyle = "#a7b0bd";
    context.font = "11px system-ui, sans-serif";
    context.fillText(
      `${clipName} · ${solverVersion}`,
      14,
      GIF_HEIGHT - FOOTER_HEIGHT / 2,
    );
    context.textAlign = "right";
    context.fillText(
      `${time.toFixed(2)}s / ${duration.toFixed(2)}s`,
      GIF_WIDTH - 14,
      GIF_HEIGHT - FOOTER_HEIGHT / 2,
    );
    context.textAlign = "left";

    const image = context.getImageData(0, 0, GIF_WIDTH, GIF_HEIGHT);
    const pixels = new Uint8Array(
      image.data.buffer,
      image.data.byteOffset,
      image.data.byteLength,
    );
    const palette = quantize(pixels, 128);
    const indexed = applyPalette(pixels, palette);

    gif.writeFrame(indexed, GIF_WIDTH, GIF_HEIGHT, {
      palette,
      delay: frameDelay,
      repeat: frame === 0 ? 0 : undefined,
    });

    onProgress?.((frame + 1) / frameCount);

    if (frame % 4 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  gif.finish();
  const bytes = gif.bytes();
  const safeBytes = new Uint8Array(bytes.length);
  safeBytes.set(bytes);

  const blob = new Blob([safeBytes.buffer], { type: "image/gif" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${cleanFilename(clipName)}-${solverVersion}-comparison.gif`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function THREEClamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}