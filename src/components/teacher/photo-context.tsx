"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  dequeuePhoto,
  enqueuePhoto,
  MIN_UPLOAD_INTERVAL_MS,
  pendingPhotos,
  queueFull,
  queueKey,
  shouldDrain,
  type QueuedPhoto,
} from "./photo-queue";

/** No Retry-After to go on: the same backoff RequestForm uses for a flush. */
const DEFAULT_RETRY_SECONDS = 15;

/** A ceiling, so a server that says "try in an hour" does not strand a tab. */
const MAX_RETRY_SECONDS = 120;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Who owns a photograph between the shutter and the school.
 *
 * THE DRAIN LOOP LIVES HERE, NOT IN THE FIELD, and that is the whole reason
 * this file exists. The list renders ten rows at a time; a photo queued on a
 * row that then scrolls out of the rendered set would sit in IndexedDB for ever
 * if its own component owned the retry. This provider is mounted for the whole
 * session, so every queued photo drains whether or not its row is on screen.
 *
 * ONE AT A TIME, OLDEST FIRST. Parallel uploads on a bad link produce several
 * timeouts instead of one success — see shouldDrain in photo-queue.ts.
 *
 * The pathname a successful upload returns is handed straight to `onUploaded`,
 * which writes it into the row exactly as though she had typed it. Everything
 * downstream — the commit timer, the batch flush, the frozen-snapshot diff, the
 * office review queue — is untouched and does not know a camera was involved.
 */

export type PhotoStatus =
  | { state: "idle" }
  /** Bytes on the phone, nothing sent. Either offline or waiting its turn. */
  | { state: "queued" }
  | { state: "uploading"; percent: number }
  /** The last attempt failed. It stays queued and will be retried. */
  | { state: "failed" }
  /** IndexedDB is unavailable, so this photo exists only in this tab. */
  | { state: "unsaved" };

type PhotoApi = {
  token: string;
  capture: (studentId: string, full: Blob, thumb: Blob | null) => Promise<void>;
  statusFor: (studentId: string) => PhotoStatus;
  /** A local object URL for what she just took, before any round trip. */
  previewFor: (studentId: string) => string | null;
  /** True once the queue is at its cap and she should stop and reconnect. */
  full: boolean;
};

const PhotoContext = createContext<PhotoApi | null>(null);

export function usePhotos(): PhotoApi {
  const api = useContext(PhotoContext);
  if (!api) throw new Error("usePhotos used outside <PhotoProvider>");
  return api;
}

export function PhotoProvider({
  token,
  online,
  onUploaded,
  queueCap,
  children,
}: {
  token: string;
  online: boolean;
  /** Called with the blob pathname once the school actually has the bytes. */
  onUploaded: (studentId: string, pathname: string) => void;
  /**
   * How many photos may wait before she is told to stop.
   *
   * Defaults to the phone's cap. The master link passes MASTER_QUEUE_CAP,
   * because a folder of two hundred is one gesture there and ten refusals at
   * twenty — see the note on both constants in photo-queue.ts.
   */
  queueCap?: number;
  children: React.ReactNode;
}) {
  const [statuses, setStatuses] = useState<Record<string, PhotoStatus>>({});
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [waiting, setWaiting] = useState(0);
  const inFlight = useRef(false);
  // Read by the drain loop, which must never be re-created on every keystroke.
  const uploaded = useRef(onUploaded);
  uploaded.current = onUploaded;

  const setStatus = useCallback((studentId: string, status: PhotoStatus) => {
    setStatuses((current) => ({ ...current, [studentId]: status }));
  }, []);

  /**
   * A failed drain restarts itself, which it did not used to.
   *
   * THE BUG THIS CLOSES was invisible on the surface it was written for and
   * fatal on the one added later. `drain` breaks out of its loop on the first
   * failure, and the only things that ever called it again were mounting, going
   * back online, and taking another photograph. On a teacher's phone the third
   * of those is never far away, so a single 429 healed itself the next time she
   * pressed the shutter. On a two-hundred-file drop there IS no next capture —
   * the queue simply stopped, with everything still in it, saying "failed" and
   * meaning "abandoned".
   *
   * `Retry-After` is what the server already sends with every 429 (see
   * api/r/[token]/guard.ts); this is the first thing to read it. Anything else
   * — no signal, a timeout, a 500 — gets a flat fifteen seconds, which is the
   * same number RequestForm backs off by for the answer flush.
   */
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastUploadAt = useRef(0);
  const drainRef = useRef<() => void>(() => {});

  const scheduleRetry = useCallback((error: unknown) => {
    const seconds =
      error instanceof UploadError && error.retryAfterSeconds
        ? error.retryAfterSeconds
        : DEFAULT_RETRY_SECONDS;

    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(
      () => {
        retryTimer.current = null;
        drainRef.current();
      },
      Math.max(1, Math.min(seconds, MAX_RETRY_SECONDS)) * 1000,
    );
  }, []);

  /* ----------------------------------------------------------- the drain */
  const drain = useCallback(async () => {
    if (inFlight.current) return;
    const queue = await pendingPhotos(token);
    setWaiting(queue.length);
    if (!shouldDrain(navigator.onLine, inFlight.current, queue.length)) return;

    inFlight.current = true;
    try {
      // Oldest first, one at a time, and stop at the first failure rather than
      // marching through twenty on a link that has just proved it is down.
      for (const photo of queue) {
        // PACED. Two hundred files dropped at once would otherwise spend the
        // whole minute's upload budget and start colliding with their own
        // retries. A teacher taking one photograph at a time never waits here:
        // she cannot press the shutter twice inside the interval.
        const since = Date.now() - lastUploadAt.current;
        if (since < MIN_UPLOAD_INTERVAL_MS) {
          await sleep(MIN_UPLOAD_INTERVAL_MS - since);
        }

        setStatus(photo.studentId, { state: "uploading", percent: 0 });
        let pathname: string;
        try {
          pathname = await upload(token, photo, (percent) =>
            setStatus(photo.studentId, { state: "uploading", percent }),
          );
        } catch (error) {
          setStatus(photo.studentId, { state: "failed" });
          scheduleRetry(error);
          break;
        } finally {
          lastUploadAt.current = Date.now();
        }
        await dequeuePhoto(photo.key);
        setStatus(photo.studentId, { state: "idle" });
        uploaded.current(photo.studentId, pathname);
      }
    } finally {
      inFlight.current = false;
      setWaiting((await pendingPhotos(token)).length);
    }
  }, [token, setStatus, scheduleRetry]);

  // So the retry timer can reach the CURRENT drain without being rebuilt every
  // time drain's identity changes — which would restart the timer with it.
  drainRef.current = () => void drain();

  // A pending retry must not outlive the surface that scheduled it.
  useEffect(
    () => () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );

  /* --------------------------------------------------------- the capture */
  const capture = useCallback(
    async (studentId: string, full: Blob, thumb: Blob | null) => {
      // Shown instantly and locally. She has just pointed a camera at a child
      // standing in front of her; making her wait for a server round trip to
      // see the result is the difference between two seconds and ten.
      const url = URL.createObjectURL(full);
      setPreviews((current) => {
        const previous = current[studentId];
        if (previous) URL.revokeObjectURL(previous);
        return { ...current, [studentId]: url };
      });

      const photo: QueuedPhoto = {
        key: queueKey(token, studentId),
        token,
        studentId,
        blob: full,
        thumb,
        capturedAt: Date.now(),
      };

      await enqueuePhoto(photo);
      const queued = await pendingPhotos(token);
      setWaiting(queued.length);
      // enqueuePhoto swallows an unavailable IndexedDB rather than throwing, so
      // this is how we find out — and she is told, because "it is on the phone"
      // would be a lie in a WebView that has no store.
      setStatus(
        studentId,
        queued.some((entry) => entry.studentId === studentId)
          ? { state: "queued" }
          : { state: "unsaved" },
      );

      void drain();
    },
    [token, setStatus, drain],
  );

  /**
   * Show again what is still on the phone.
   *
   * A preview is an object URL in component state, so a reload throws it away —
   * and the photograph behind it is still sitting in IndexedDB waiting for
   * signal. A teacher working in a dead spot took twelve photographs, reloaded,
   * and saw twelve empty placeholders: nothing was lost, but she had no way to
   * know that, and the only rational thing to do looking at that screen is take
   * them all again.
   *
   * Runs once per token, before the drain that will clear the queue. Each one
   * that uploads is replaced by the stored image via the row's `value`, so
   * these URLs are transitional — the unmount cleanup revokes whatever is left.
   */
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    let cancelled = false;

    void (async () => {
      const queue = await pendingPhotos(token);
      if (cancelled || queue.length === 0) return;
      setPreviews((current) => {
        const next = { ...current };
        for (const photo of queue) {
          // Never over a live preview: she may have retaken one in the moment
          // between mount and this resolving, and hers is the newer picture.
          if (next[photo.studentId]) continue;
          next[photo.studentId] = URL.createObjectURL(photo.blob);
        }
        return next;
      });
      setStatuses((current) => {
        const next = { ...current };
        for (const photo of queue) {
          next[photo.studentId] ??= { state: "queued" };
        }
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  // On mount and whenever signal returns. Capture kicks it directly, and a
  // successful upload continues through the loop it is already inside — so
  // there is no polling timer, and deliberately no dependency on `statuses`,
  // which the drain itself writes and which would make this re-enter for ever.
  useEffect(() => {
    void drain();
  }, [drain, online]);

  // Object URLs are a leak if nobody lets go of them, and a round is forty-six.
  const previewsRef = useRef(previews);
  previewsRef.current = previews;
  useEffect(
    () => () => {
      for (const url of Object.values(previewsRef.current)) {
        URL.revokeObjectURL(url);
      }
    },
    [],
  );

  return (
    <PhotoContext.Provider
      value={{
        token,
        capture,
        statusFor: (studentId) => statuses[studentId] ?? { state: "idle" },
        previewFor: (studentId) => previews[studentId] ?? null,
        full: queueFull(waiting, queueCap),
      }}
    >
      {children}
    </PhotoContext.Provider>
  );
}

/**
 * XMLHttpRequest rather than fetch, for one reason: `upload.onprogress`.
 *
 * fetch cannot report how much of a request body has gone. On a 2G link a
 * spinner that never moves is exactly what makes someone tap again, and the
 * second tap is a second upload of the same 100 KB down the same narrow pipe.
 */
function upload(
  token: string,
  photo: QueuedPhoto,
  onProgress: (percent: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    body.append("studentId", photo.studentId);
    body.append("file", photo.blob, "photo.jpg");
    if (photo.thumb) body.append("thumb", photo.thumb, "thumb.jpg");

    const request = new XMLHttpRequest();
    request.open("POST", `/api/r/${token}/photo`);
    request.responseType = "json";
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.onerror = () => reject(new UploadError("No signal."));
    request.ontimeout = () => reject(new UploadError("Timed out."));
    request.onload = () => {
      const pathname = (request.response as { pathname?: string } | null)
        ?.pathname;
      if (request.status === 201 && typeof pathname === "string") {
        resolve(pathname);
        return;
      }
      // The server says how long to wait; the queue is what listens. Without
      // carrying this out of here a 429 was indistinguishable from a dead link.
      const header = request.getResponseHeader("retry-after");
      const retryAfter = header ? Number(header) : NaN;
      reject(
        new UploadError(`Upload refused (${request.status}).`, {
          status: request.status,
          retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : null,
        }),
      );
    };
    request.send(body);
  });
}

/** An upload that failed, and what the server said about trying again. */
class UploadError extends Error {
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    info?: { status?: number; retryAfterSeconds?: number | null },
  ) {
    super(message);
    this.name = "UploadError";
    this.status = info?.status ?? null;
    this.retryAfterSeconds = info?.retryAfterSeconds ?? null;
  }
}
