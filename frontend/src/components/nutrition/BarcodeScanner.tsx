import { type FormEvent, useEffect, useRef, useState } from "react";
import { normaliseBarcode, pickDetector } from "../../lib/barcode";

const FRAME_MS = 250;
const FRAME_WIDTH = 720;

type Props = { onCode: (code: string) => void; busy?: boolean };

/** Camera barcode scanning with a typed-in fallback that is always available. */
export function BarcodeScanner({ onCode, busy = false }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState<"starting" | "scanning" | "unavailable">("starting");
  const [cameraMessage, setCameraMessage] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const found = useRef(onCode);
  useEffect(() => {
    found.current = onCode;
  });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;
    const canvas = document.createElement("canvas");

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamera("unavailable");
        setCameraMessage("This browser can't use the camera. Type the barcode instead.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const detector = await pickDetector();
        if (cancelled) return;
        setCamera("scanning");
        let reading = false;
        timer = setInterval(async () => {
          const v = video.current;
          if (reading || !v || v.videoWidth === 0) return;
          reading = true;
          try {
            const scale = Math.min(1, FRAME_WIDTH / v.videoWidth);
            canvas.width = Math.round(v.videoWidth * scale);
            canvas.height = Math.round(v.videoHeight * scale);
            canvas.getContext("2d")?.drawImage(v, 0, 0, canvas.width, canvas.height);
            const code = normaliseBarcode((await detector.detect(canvas)) ?? "");
            if (code && !cancelled) {
              clearInterval(timer);
              found.current(code);
            }
          } finally {
            reading = false;
          }
        }, FRAME_MS);
      } catch (e) {
        if (cancelled) return;
        setCamera("unavailable");
        setCameraMessage(
          e instanceof DOMException && e.name === "NotAllowedError"
            ? "Camera access is blocked. Allow it in your browser settings, or type the barcode."
            : "Couldn't start the camera. Type the barcode instead.",
        );
      }
    }
    void start();
    return () => {
      cancelled = true;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const code = normaliseBarcode(manual);
    if (!code) return setManualError("Barcodes are 6 to 14 digits");
    setManualError(null);
    onCode(code);
  };

  return (
    <div className="space-y-3">
      {camera !== "unavailable" ? (
        <div className="relative overflow-hidden rounded-2xl bg-black">
          <video
            ref={video}
            muted
            playsInline
            aria-label="Camera preview"
            className="aspect-[4/3] w-full object-cover"
          />
          {/* Aiming guide */}
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-xl border-2 border-white/80" />
          <p
            role="status"
            className="absolute inset-x-0 bottom-0 bg-black/50 px-3 py-1.5 text-center text-sm text-white"
          >
            {busy
              ? "Looking it up…"
              : camera === "starting"
                ? "Starting camera…"
                : "Point at the barcode"}
          </p>
        </div>
      ) : (
        <p role="status" className="rounded-xl bg-surface-2 px-3 py-2 text-sm">
          {cameraMessage}
        </p>
      )}
      <form onSubmit={submit} noValidate className="flex items-end gap-2">
        <label className="block flex-1 text-sm">
          <span className="mb-1 block text-muted">Or type the barcode</span>
          <input
            inputMode="numeric"
            autoComplete="off"
            value={manual}
            onChange={(e) => setManual(e.target.value.replace(/[^\d\s]/g, ""))}
            aria-invalid={manualError ? true : undefined}
            className="tabular w-full rounded-xl border border-border bg-surface px-3 py-2.5"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-accent px-4 py-2.5 font-medium text-bg disabled:opacity-60"
        >
          Look up
        </button>
      </form>
      {manualError && <p className="text-xs text-bad">{manualError}</p>}
    </div>
  );
}
