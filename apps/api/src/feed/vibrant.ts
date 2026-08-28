/**
 * node-vibrant, running on sharp's pixels.
 *
 * Vibrant's own Node build ships an image class backed by Jimp, which would
 * mean carrying a second image decoder purely to hand the quantiser a pixel
 * array — in a container that is already the tightest resource on the
 * deployment. Sharp is here, is faster, and is what the rest of the API uses.
 *
 * So the dependency is on Vibrant's own component packages rather than the
 * `node-vibrant` umbrella, and this module assembles the pipeline by hand: the
 * registrations below are verbatim what `node-vibrant/node` performs at import,
 * minus the Jimp image class. Depending on the umbrella and simply overriding
 * `ImageClass` would read more neatly and would still put four megabytes of
 * unreachable decoder into every install — including the one that has to fit on
 * the free plan.
 *
 * The pipeline is assembled once, at module load. `Vibrant.use` is static —
 * registering it per call would rebuild the same three stages on every cover.
 */

import { BasicPipeline, Vibrant } from '@vibrant/core';
import { DefaultGenerator } from '@vibrant/generator-default';
import type { Image, ImageData, ImageSource } from '@vibrant/image';
import { MMCQ } from '@vibrant/quantizer-mmcq';
import sharp from 'sharp';

/**
 * The square the cover is sampled down to before quantising.
 *
 * 128 is 16,384 samples, which median-cut chews through in about a
 * millisecond. The predecessor used a 16×16 grid — 256 samples — and that is
 * a genuinely coarse read of a 3000px cover: a gradient, a photo, or any
 * detail smaller than a sixteenth of the artwork simply was not in the data.
 */
const SAMPLE = 128;

/**
 * Decoded-pixel ceiling, which the byte ceiling on the download does not give.
 *
 * The fetch is capped at 8MB, but 8MB of PNG can decode to hundreds of
 * megapixels, and sharp's own default allows about 268 of them — a gigabyte of
 * RGBA in a 512MB container. 40MP is far above any real podcast cover and far
 * below anything that can hurt the process.
 */
const MAX_INPUT_PIXELS = 40_000_000;

/**
 * An `Image` for Vibrant that decodes with sharp.
 *
 * The interface is mostly synchronous, and sharp is not, so every decode and
 * every resize happens in `load` — the one hook that may await. That is also
 * why this class only accepts a `Buffer`: a string source would mean Vibrant
 * fetching the URL itself, and artwork URLs come out of publisher-controlled
 * RSS. They are fetched exactly once, through the guard in `artwork-color.ts`,
 * and only the resulting bytes ever reach here.
 */
export class SharpImage implements Image {
  private imageData: ImageData | null = null;

  async load(source: ImageSource): Promise<Image> {
    if (!Buffer.isBuffer(source)) {
      throw new TypeError('SharpImage takes already-fetched bytes, not a URL.');
    }

    const { data, info } = await sharp(source, { limitInputPixels: MAX_INPUT_PIXELS })
      // Drop alpha by compositing onto black: a transparent PNG's empty
      // corners are not part of the cover's colour.
      .flatten({ background: '#000000' })
      // `inside` rather than `fill`. Squashing a wide banner into a square
      // over-weights whatever happens to be stretched horizontally, and the
      // quantiser counts pixels.
      .resize(SAMPLE, SAMPLE, { fit: 'inside', withoutEnlargement: true })
      // Vibrant's histogram reads RGBA quads and skips alpha 0; the filter
      // stage marks rejected pixels by zeroing alpha, so the channel has to
      // exist even though `flatten` just made it meaningless.
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    this.imageData = { data, width: info.width, height: info.height };
    return this;
  }

  getImageData(): ImageData {
    if (!this.imageData) throw new Error('SharpImage.getImageData before load');
    return this.imageData;
  }

  update(imageData: ImageData): void {
    this.imageData = imageData;
  }

  getWidth(): number {
    return this.imageData?.width ?? 0;
  }

  getHeight(): number {
    return this.imageData?.height ?? 0;
  }

  getPixelCount(): number {
    return this.getWidth() * this.getHeight();
  }

  /**
   * Nearest-neighbour, because this hook cannot await sharp.
   *
   * In practice it never runs: `load` has already produced the sample size and
   * the extractor asks for no further downsampling, so `scaleDown` computes a
   * ratio of 1 and skips it. It exists so the class honours the interface
   * rather than throwing if a caller ever does set `quality` or `maxDimension`.
   */
  resize(targetWidth: number, targetHeight: number): void {
    const current = this.imageData;
    if (!current) return;

    const width = Math.max(1, Math.round(targetWidth));
    const height = Math.max(1, Math.round(targetHeight));
    if (width >= current.width && height >= current.height) return;

    const resized = Buffer.allocUnsafe(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      const sourceY = Math.min(current.height - 1, Math.floor((y * current.height) / height));
      for (let x = 0; x < width; x += 1) {
        const sourceX = Math.min(current.width - 1, Math.floor((x * current.width) / width));
        const from = (sourceY * current.width + sourceX) * 4;
        const to = (y * width + x) * 4;
        resized[to] = current.data[from]!;
        resized[to + 1] = current.data[from + 1]!;
        resized[to + 2] = current.data[from + 2]!;
        resized[to + 3] = current.data[from + 3]!;
      }
    }

    this.imageData = { data: resized, width, height };
  }

  clear(): void {
    this.imageData = null;
  }

  remove(): void {
    this.imageData = null;
  }

  /**
   * Inherited behaviour, spelled out: with `quality: 1` and no `maxDimension`
   * the ratio is 1 and nothing happens. `load` already did the scaling.
   */
  scaleDown(): void {
    // Intentionally empty — see `resize`.
  }
}

/**
 * The stock Vibrant pipeline: the default alpha/near-white filter, median-cut
 * quantisation, and the generator that sorts the resulting colours into the
 * six named swatches. Identical to what `node-vibrant/node` registers.
 */
const pipeline = new BasicPipeline()
  .filter.register(
    'default',
    (r: number, g: number, b: number, a: number) => a >= 125 && !(r > 250 && g > 250 && b > 250),
  )
  .quantizer.register('mmcq', MMCQ)
  .generator.register('default', DefaultGenerator);

Vibrant.use(pipeline);
Vibrant.DefaultOpts.quantizer = 'mmcq';
Vibrant.DefaultOpts.generators = ['default'];
Vibrant.DefaultOpts.filters = ['default'];
Vibrant.DefaultOpts.ImageClass = SharpImage;
/** The image is already at sample size, so the quantiser skips no pixels. */
Vibrant.DefaultOpts.quality = 1;

export { Vibrant };
