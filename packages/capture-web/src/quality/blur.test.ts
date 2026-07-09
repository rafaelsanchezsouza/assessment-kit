import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blurriness, checkImageQuality, laplacianSharpness, type ImageDataLike } from './blur.ts';

function syntheticImage(width: number, height: number, pixel: (x: number, y: number) => number): ImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = pixel(x, y);
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

const sharpCheckerboard = syntheticImage(64, 64, (x, y) => ((x + y) % 2 === 0 ? 255 : 0));
const flatGray = syntheticImage(64, 64, () => 128);
const softGradient = syntheticImage(64, 64, (x) => Math.round((x / 63) * 255));

test('sharp high-frequency image scores far above a flat one', () => {
  const sharp = laplacianSharpness(sharpCheckerboard);
  const flat = laplacianSharpness(flatGray);
  assert.ok(sharp > 100, `checkerboard should be very sharp, got ${sharp}`);
  assert.equal(flat, 0);
});

test('a soft gradient scores low but nonzero-ish sharpness', () => {
  const soft = laplacianSharpness(softGradient);
  assert.ok(soft < 12, `gradient should read as blurry, got ${soft}`);
});

test('blurriness normalization maps sharpness 12 to exactly 0.4', () => {
  assert.ok(Math.abs(blurriness(12) - 0.4) < 1e-9);
  assert.ok(blurriness(0) === 1);
  assert.ok(blurriness(1000) < 0.01);
});

test('checkImageQuality applies maxBlur from validationRules', () => {
  const sharpResult = checkImageQuality(sharpCheckerboard, { maxBlur: 0.4 });
  assert.equal(sharpResult.ok, true);

  const blurryResult = checkImageQuality(flatGray, { maxBlur: 0.4 });
  assert.equal(blurryResult.ok, false);
  assert.equal(blurryResult.failures[0].rule, 'maxBlur');
});

test('checkImageQuality applies minResolution orientation-agnostically', () => {
  // analysis copy is downscaled; full capture dimensions are what count
  const portrait = checkImageQuality(sharpCheckerboard, { minResolution: [1280, 720] }, 1080, 1920);
  assert.equal(portrait.ok, true, 'portrait 1080x1920 satisfies landscape-form 1280x720');

  const tooSmall = checkImageQuality(sharpCheckerboard, { minResolution: [1280, 720] }, 640, 480);
  assert.equal(tooSmall.ok, false);
  assert.equal(tooSmall.failures[0].rule, 'minResolution');
});

test('no rules means every capture passes', () => {
  assert.equal(checkImageQuality(flatGray, undefined).ok, true);
  assert.equal(checkImageQuality(flatGray, {}).ok, true);
});

test('unknown rules are ignored (forward compatibility)', () => {
  const result = checkImageQuality(sharpCheckerboard, { futureRule: 'whatever', maxBlur: 0.4 });
  assert.equal(result.ok, true);
});
