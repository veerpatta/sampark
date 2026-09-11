/**
 * Photographs waiting for signal.
 *
 * WHY THIS IS NOT IN THE DRAFT. `draft.ts` persists her answers to localStorage
 * as strings, and its own note says IndexedDB "would be the right answer for
 * megabytes; this is not that". Photographs ARE that. A base64 JPEG is about
 * 133 KB of string, ten of them exceed the localStorage quota, and `saveDraft`
 * swallows the quota error in a bare catch — so a queue of photos in there
 * would silently destroy her typed answers as well as the photos. Two stores,
 * strictly separate: strings there, bytes here.
 *
 * IndexedDB holds a `Blob` natively, with no base64 inflation and no
 * main-thread stringify on a cheap phone.
 *
 * WHAT IS DELIBERATELY NOT QUEUED IS THE ANSWER. A queued photo does NOT write
 * a value into the row — the row simply stays unanswered until the upload
 * succeeds, at which point the pathname arrives like any other typed value.
 * That means `judgeRow` already treats it correctly (the row is `partial`, it
 * stays open, it stays in the count) and autosave.ts needed no change at all.
 * Her text answers flush immediately; only the bytes wait.
 *
 * The decisions are pure functions at the bottom so they can be tested without
 * IndexedDB, the same split autosave.ts uses against the DOM.
 */

const DB_NAME = "sampark-photos";
const STORE = "queue";

export type QueuedPhoto = {
  /** `${token}|${studentId}` — one pending photo per child per link. */
  key: string;
  token: string;
  studentId: string;
  /** The downscaled JPEG, ready to send. */
  blob: Blob;
  /** The 96px variant, drawn in the same canvas pass. */
  thumb: Blob | null;
  capturedAt: number;
};

/** Above this she is told, rather than silently filling her phone. */
export const QUEUE_CAP = 20;

/**
 * The same cap for the office, which is a different machine doing a different
 * job.
 *
 * TWENTY IS RIGHT FOR A VILLAGE PHONE and wrong for the round's master link.
 * A teacher queues photographs one at a time as she takes them, and twenty
 * waiting means something is wrong with her signal — telling her is the kind
 * thing. The office drops two hundred files from a folder in one gesture, and
 * refusing at twenty would turn one drop into ten.
 *
 * At the 800px, quality-0.8 output of ui/downscale.ts a photo is about 100 KB,
 * so three hundred is roughly 30 MB of blobs in IndexedDB — well inside any
 * desktop quota, and the entries drain and delete as they go.
 */
export const MASTER_QUEUE_CAP = 300;

/**
 * The gap between two uploads while draining.
 *
 * 40 a minute, against a budget of 60 (LIMITS.perPhotoToken). The headroom is
 * not politeness: a drop of two hundred that saturated the bucket would take
 * the whole minute's allowance and start colliding with its own retries, which
 * is slower than pacing as well as noisier. A teacher taking one photograph at
 * a time never reaches this — she cannot press the shutter twice in 1.5s.
 */
export const MIN_UPLOAD_INTERVAL_MS = 1_500;

/** Matches the draft's own age limit — a photo from last term is not wanted. */
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const queueKey = (token: string, studentId: string) =>
  `${token}|${studentId}`;

/* ------------------------------------------------------------------ store */

/**
 * IndexedDB is genuinely absent in some Android WebViews and in private mode.
 * Every function below resolves to a harmless empty value rather than throwing,
 * and the caller falls back to "upload now or lose it", told plainly. Same
 * philosophy as loadDraft's catch.
 */
function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, 1);
    } catch {
      return resolve(null);
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        let request: IDBRequest<T>;
        try {
          request = work(db.transaction(STORE, mode).objectStore(STORE));
        } catch {
          db.close();
          return resolve(null);
        }
        request.onsuccess = () => {
          resolve(request.result);
          db.close();
        };
        request.onerror = () => {
          resolve(null);
          db.close();
        };
      }),
  );
}

export async function enqueuePhoto(photo: QueuedPhoto): Promise<void> {
  await run("readwrite", (store) => store.put(photo));
}

export async function dequeuePhoto(key: string): Promise<void> {
  await run("readwrite", (store) => store.delete(key));
}

/**
 * Everything still waiting for this link, oldest first, minus anything stale.
 *
 * Stale entries are dropped here rather than by a sweeper: this runs on mount
 * and on reconnect, which is every moment one could possibly matter.
 */
export async function pendingPhotos(
  token: string,
  now = Date.now(),
): Promise<QueuedPhoto[]> {
  const all = (await run<QueuedPhoto[]>("readonly", (store) =>
    store.getAll(),
  )) as QueuedPhoto[] | null;
  if (!all) return [];

  const stale = all.filter((photo) => isStale(photo, now));
  for (const photo of stale) await dequeuePhoto(photo.key);

  return all
    .filter((photo) => photo.token === token && !isStale(photo, now))
    .sort(oldestFirst);
}

/* ---------------------------------------------------------- the decisions */

export const isStale = (photo: { capturedAt: number }, now: number) =>
  now - photo.capturedAt > MAX_AGE_MS;

export const oldestFirst = (
  a: { capturedAt: number },
  b: { capturedAt: number },
) => a.capturedAt - b.capturedAt;

export const queueFull = (length: number, cap: number = QUEUE_CAP) =>
  length >= cap;

/**
 * Should the drain loop run right now?
 *
 * ONE AT A TIME, AND ONLY WHEN ONLINE. Six parallel uploads on a 2G link
 * produce six timeouts where one sequential attempt would have produced one
 * success — the phone's own connection is the bottleneck, and racing it makes
 * every attempt slower rather than any of them faster.
 */
export const shouldDrain = (
  online: boolean,
  inFlight: boolean,
  waiting: number,
) => online && !inFlight && waiting > 0;
