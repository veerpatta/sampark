import { get, head } from "@vercel/blob";

/**
 * Fetching a private blob BY PATHNAME, including the pathnames `get` alone
 * cannot resolve.
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
 *
 * Shared by the photo reader and the documents proxy because it is one bug
 * about ids, not two bugs about files.
 */
export async function getBlob(pathname: string) {
  const direct = await get(pathname, { access: "private" });
  if (direct) return direct;

  // `head` throws rather than resolving null when there is genuinely nothing
  // there, which is the ordinary reason to be here and not worth an error.
  const meta = await head(pathname).catch(() => null);
  return meta ? await get(meta.url, { access: "private" }) : null;
}
