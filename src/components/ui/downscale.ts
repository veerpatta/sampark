/**
 * Turning what the camera produced into something a 2G link can carry.
 *
 * A modern Android camera hands over a 3–8 MB JPEG. Sending that from a
 * staffroom in Amet is a minute per child and a teacher who gives up on the
 * third one. An 800px long edge at quality 0.8 is about 100 KB — the same face,
 * three seconds instead of sixty — and 96px alongside it is the thumbnail the
 * office's students board renders a hundred of.
 *
 * TWO THINGS HERE ARE NOT OPTIONAL AND BOTH ARE ABOUT CHEAP PHONES.
 *
 * EXIF ORIENTATION. Many Android phones store a portrait photograph as a
 * landscape frame plus an orientation tag. `createImageBitmap` with
 * `imageOrientation: "from-image"` applies the tag; drawing an <img> to a canvas
 * does not, reliably, which is why that is only the fallback and why this needs
 * checking on a real handset rather than in a desktop browser.
 *
 * RELEASING MEMORY. Forty-six full-resolution decodes held live will run a
 * cheap phone out of memory, and the symptom is the tab dying mid-round with
 * her work in it. Every bitmap is closed and every object URL revoked on every
 * path out of here, including the failing ones.
 *
 * WHY IT SITS IN ui/ AND NOT teacher/. The office console replaces photographs
 * too, and it runs this same module rather than a second one — so a face
 * uploaded from a desk produces the identical 800px/96px pair as one taken on a
 * phone in a staffroom. That is what lets photo-store.ts fetch full-then-thumb,
 * and the workbook draw at 96px, without either of them knowing which door a
 * photograph came in through. Everything still in components/teacher/ is
 * genuinely Hindi-first and phone-only; this never was.
 */

/** Long edge of the stored photo. A face at 800px is plenty to recognise. */
const FULL_EDGE = 800;

/** Long edge of the list thumbnail. */
const THUMB_EDGE = 96;

const QUALITY = 0.8;

export type Downscaled = {
  full: Blob;
  /** Null when the browser refused the second encode. The full image still went. */
  thumb: Blob | null;
};

export async function downscale(file: File): Promise<Downscaled> {
  const source = await decode(file);
  try {
    const full = await encode(source, FULL_EDGE);
    if (!full) throw new Error("The phone could not prepare this photo.");
    // A failed thumbnail is not a failed photo. The board falls back to the
    // full image; losing the photograph over its 4 KB sidecar would be absurd.
    const thumb = await encode(source, THUMB_EDGE).catch(() => null);
    return { full, thumb };
  } finally {
    close(source);
  }
}

type Source = { image: CanvasImageSource; width: number; height: number };

async function decode(file: File): Promise<Source> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      return { image: bitmap, width: bitmap.width, height: bitmap.height };
    } catch {
      // Fall through. Some older WebViews have createImageBitmap but reject the
      // options bag rather than ignoring it.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("That file is not a photo."));
      element.src = url;
    });
    return { image, width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function close(source: Source) {
  if (typeof ImageBitmap !== "undefined" && source.image instanceof ImageBitmap) {
    source.image.close();
  }
}

function encode(source: Source, edge: number): Promise<Blob | null> {
  // NEVER UPSCALE. A 300px photo re-encoded at 800 is a bigger file of the same
  // picture, which is the one outcome this whole module exists to avoid.
  const scale = Math.min(1, edge / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) return Promise.resolve(null);
  context.drawImage(source.image, 0, 0, width, height);

  return new Promise((resolve) => {
    if (typeof canvas.toBlob === "function") {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", QUALITY);
      return;
    }
    // Old WebViews. Slower and it holds a base64 copy for a moment, but it is
    // the difference between a photo and no photo on that handset.
    resolve(dataUrlToBlob(canvas.toDataURL("image/jpeg", QUALITY)));
  });
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "image/jpeg" });
}
