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
  pendingPhotos,
  queueFull,
  queueKey,
  shouldDrain,
  type QueuedPhoto,
} from "./photo-queue";

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
  children,
}: {
  token: string;
  online: boolean;
  /** Called with the blob pathname once the school actually has the bytes. */
  onUploaded: (studentId: string, pathname: string) => void;
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
        setStatus(photo.studentId, { state: "uploading", percent: 0 });
        let pathname: string;
        try {
          pathname = await upload(token, photo, (percent) =>
            setStatus(photo.studentId, { state: "uploading", percent }),
          );
        } catch {
          setStatus(photo.studentId, { state: "failed" });
          break;
        }
        await dequeuePhoto(photo.key);
        setStatus(photo.studentId, { state: "idle" });
        uploaded.current(photo.studentId, pathname);
      }
    } finally {
      inFlight.current = false;
      setWaiting((await pendingPhotos(token)).length);
    }
  }, [token, setStatus]);

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
        full: queueFull(waiting),
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
    request.onerror = () => reject(new Error("No signal."));
    request.ontimeout = () => reject(new Error("Timed out."));
    request.onload = () => {
      const pathname = (request.response as { pathname?: string } | null)
        ?.pathname;
      if (request.status === 201 && typeof pathname === "string") {
        resolve(pathname);
        return;
      }
      reject(new Error(`Upload refused (${request.status}).`));
    };
    request.send(body);
  });
}
