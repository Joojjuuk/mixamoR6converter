declare module "gifenc" {
  export type GIFPalette = number[][];

  export type GIFFrameOptions = {
    palette: GIFPalette;
    delay?: number;
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
  };

  export type GIFEncoderInstance = {
    writeFrame: (
      indexedPixels: Uint8Array,
      width: number,
      height: number,
      options: GIFFrameOptions,
    ) => void;
    finish: () => void;
    bytes: () => Uint8Array;
  };

  export function GIFEncoder(): GIFEncoderInstance;
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
  ): GIFPalette;
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GIFPalette,
  ): Uint8Array;
}