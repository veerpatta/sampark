import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * SERVER ONLY. The one place that knows WHERE file bytes live.
 *
 * Two hosts, during the move:
 *
 *   ON CLOUDFLARE WORKERS the bytes are in the R2 bucket bound as `FILES`
 *   (wrangler.jsonc). The key is the pathname, byte for byte — the same string
 *   students.photo_path and student_documents.pathname already hold. The bucket
 *   is private: there is no public URL, every read still goes through the same
 *   session- or roster-checked proxy routes.
 *
 *   ON VERCEL (and in every Node script under scripts/) the bytes stay in the
 *   private Vercel Blob store, exactly as before, through BLOB_READ_WRITE_TOKEN.
 *
 * The choice is made per call, not at build time: getCloudflareContext() only
 * answers inside a Worker request, and throws everywhere else. So one build of
 * this module is correct on both hosts and the Vercel site is untouched.
 *
 * The database is not told which store a file is in, because it does not need
 * to be: a pathname means the same file in both, and a one-time copy (Vercel
 * Blob → R2, same keys) is what makes the two agree before the switch-over.
 */

/** The R2 binding, or null when this request is not running on Workers. */
function r2(): R2BucketLike | null {
  try {
    const env = getCloudflareContext().env as unknown as { FILES?: R2BucketLike };
    return env.FILES ?? null;
  } catch {
    return null;
  }
}

/**
 * What a read hands back. The same shape @vercel/blob's `get` returns, so the
 * callers (photo-store.ts, the documents proxy) did not have to change.
 */
export type StoredBlob =
  | { statusCode: 200; stream: ReadableStream<Uint8Array> }
  | { statusCode: 304; stream: null };

export async function putBlob(
  pathname: string,
  bytes: Uint8Array,
  options: { contentType: string; cacheControlMaxAge: number },
): Promise<void> {
  const bucket = r2();
  if (bucket) {
    // allowOverwrite: false, as on Vercel. A pathname carries our own
    // randomness, so a collision is a bug and must throw rather than quietly
    // replace a photograph. A head first is the plain way to say that.
    if (await bucket.head(pathname)) {
      throw new Error(`Refusing to overwrite an existing file at ${pathname}`);
    }
    await bucket.put(pathname, bytes, {
      httpMetadata: {
        contentType: options.contentType,
        cacheControl: `private, max-age=${options.cacheControlMaxAge}, immutable`,
      },
    });
    return;
  }

  const { put } = await import("@vercel/blob");
  await put(pathname, Buffer.from(bytes), {
    access: "private",
    contentType: options.contentType,
    addRandomSuffix: false,
    allowOverwrite: false,
    cacheControlMaxAge: options.cacheControlMaxAge,
  });
}

/**
 * A file by pathname: null when there is nothing there, THROWS when the store
 * would not answer. photo-store.ts depends on that difference.
 */
export async function getBlob(pathname: string): Promise<StoredBlob | null> {
  const bucket = r2();
  if (bucket) {
    // R2 keys are exact strings, so the '%2F' pathnames of the nine RTE
    // children (see vercelGet below) need no second attempt here.
    const object = await bucket.get(pathname);
    return object ? { statusCode: 200 as const, stream: object.body } : null;
  }
  return vercelGet(pathname);
}

/** Housekeeping delete. Callers treat a failure as harmless. */
export async function deleteBlob(pathname: string): Promise<void> {
  const bucket = r2();
  if (bucket) {
    await bucket.delete(pathname);
    return;
  }
  const { del } = await import("@vercel/blob");
  await del(pathname);
}

/**
 * Fetching a private Vercel blob BY PATHNAME, including the pathnames `get`
 * alone cannot resolve.
 *
 * THE NINE CHILDREN. This school's RTE admission numbers look like '228/12RTE'
 * and 'RTE 03'. lib/photos.ts and lib/documents.ts encode the student id into a
 * single path segment so that a slash cannot invent a folder, which puts their
 * files at `students/228%2F12RTE/…`. Those files upload perfectly and are in the
 * store this minute — and `get(pathname)` returns null for every one of them.
 * The SDK does not re-encode the per-cent sign when it builds the URL, so the
 * request goes out as `…/228%2F12RTE/…`, which is read as a slash and resolves
 * to a folder nothing has ever been written to.
 *
 * `head` resolves the same pathname correctly and hands back the properly
 * encoded URL (`…/228%252F12RTE/…`), which `get` then serves with a 200. So the
 * recovery is to ask what the URL really is and fetch that.
 *
 * SECOND, NEVER FIRST. The plain pathname works for every ordinary id and costs
 * one round trip; this costs two and only runs after that has already failed.
 * And it is what keeps "missing" honest — without it, nine children whose
 * photographs and documents are sitting in the store would read as having none.
 */
async function vercelGet(pathname: string): Promise<StoredBlob | null> {
  const { get, head } = await import("@vercel/blob");
  const direct = await get(pathname, { access: "private" });
  if (direct) return direct;

  // `head` throws rather than resolving null when there is genuinely nothing
  // there, which is the ordinary reason to be here and not worth an error.
  const meta = await head(pathname).catch(() => null);
  return meta ? await get(meta.url, { access: "private" }) : null;
}

/**
 * The slice of the R2 binding this module uses. Declared here rather than
 * pulled from @cloudflare/workers-types so the Vercel build's type check does
 * not need Workers globals.
 */
type R2BucketLike = {
  head(key: string): Promise<unknown | null>;
  get(key: string): Promise<{ body: ReadableStream<Uint8Array> } | null>;
  put(
    key: string,
    value: Uint8Array,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string } },
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
};
