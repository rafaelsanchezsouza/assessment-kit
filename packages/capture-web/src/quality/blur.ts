/**
 * Client-side image quality checks ("cheap physics" per ADR-005): the client
 * rejects obviously unusable captures before upload; semantic checks are
 * server-side analyzers. All thresholds come from the protocol step's
 * `validationRules` — the SDK ships no domain defaults.
 */

/** Structural subset of the DOM ImageData — keeps this module testable in node. */
export interface ImageDataLike {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Sharpness as the standard deviation of the Laplacian over the grayscale
 * image (same metric as the validated prototype, which warned below 12 on a
 * 160×120 downscale). Higher = sharper.
 */
export function laplacianSharpness(image: ImageDataLike): number {
  const { data, width: w, height: h } = image;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const j = i * 4;
    gray[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
  }
  let sum = 0;
  let sq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = -4 * gray[i] + gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w];
      sum += v;
      sq += v * v;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sq / n - mean * mean));
}

/**
 * Normalized blurriness in (0, 1]: blur(s) = 1 / (1 + s / 8). Calibrated so
 * the demo protocol's `maxBlur: 0.4` equals the prototype's sharpness-12
 * warning threshold on the same 160×120 downscale.
 */
export function blurriness(sharpness: number): number {
  return 1 / (1 + sharpness / 8);
}

export type QualityFailure =
  | { rule: 'maxBlur'; blur: number; limit: number }
  | { rule: 'minSharpness'; sharpness: number; limit: number }
  | { rule: 'minResolution'; width: number; height: number; limit: [number, number] };

export interface QualityResult {
  ok: boolean;
  sharpness: number;
  failures: QualityFailure[];
}

/**
 * Evaluate a capture against a protocol step's `validationRules`. Unknown
 * rules are ignored (forward compatibility — protocols may declare rules a
 * newer SDK understands). `fullWidth`/`fullHeight` are the original capture
 * dimensions when `image` is a downscaled analysis copy.
 */
export function checkImageQuality(
  image: ImageDataLike,
  validationRules: Record<string, unknown> | undefined,
  fullWidth = image.width,
  fullHeight = image.height,
): QualityResult {
  const sharpness = laplacianSharpness(image);
  const failures: QualityFailure[] = [];
  const rules = validationRules ?? {};

  if (typeof rules.maxBlur === 'number') {
    const blur = blurriness(sharpness);
    if (blur > rules.maxBlur) failures.push({ rule: 'maxBlur', blur, limit: rules.maxBlur });
  }
  if (typeof rules.minSharpness === 'number' && sharpness < rules.minSharpness) {
    failures.push({ rule: 'minSharpness', sharpness, limit: rules.minSharpness });
  }
  if (Array.isArray(rules.minResolution) && rules.minResolution.length === 2) {
    const [minW, minH] = rules.minResolution as [number, number];
    // orientation-agnostic: a 1080×1920 portrait shot satisfies [1280, 720]
    const [capMajor, capMinor] = [Math.max(fullWidth, fullHeight), Math.min(fullWidth, fullHeight)];
    const [reqMajor, reqMinor] = [Math.max(minW, minH), Math.min(minW, minH)];
    if (capMajor < reqMajor || capMinor < reqMinor) {
      failures.push({ rule: 'minResolution', width: fullWidth, height: fullHeight, limit: [minW, minH] });
    }
  }

  return { ok: failures.length === 0, sharpness, failures };
}

/** Downscale + extract ImageData for analysis. Browser-only (canvas). */
export function analysisImageData(
  img: CanvasImageSource & { width?: number; height?: number },
  targetW = 160,
  targetH = 120,
): ImageDataLike {
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable');
  ctx.drawImage(img, 0, 0, targetW, targetH);
  return ctx.getImageData(0, 0, targetW, targetH);
}
