export type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** OffscreenCanvas when available, otherwise a detached HTMLCanvasElement. */
export function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

export function get2d(canvas: AnyCanvas): Ctx2D {
  const ctx = canvas.getContext('2d') as Ctx2D | null;
  if (!ctx) throw new Error('2D canvas context unavailable');
  return ctx;
}

export function canvasToJpeg(canvas: AnyCanvas, quality: number): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: 'image/jpeg', quality });
  }
  const c = canvas as HTMLCanvasElement;
  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))), 'image/jpeg', quality);
  });
}

export interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

/** Decode a JPEG blob, preferring createImageBitmap. */
export async function decodeImage(blob: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(blob);
    return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      close: () => {},
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
