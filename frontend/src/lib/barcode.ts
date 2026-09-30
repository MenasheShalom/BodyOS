/** Barcode detection from camera frames: the browser's own detector when it reads
 * EAN/UPC, otherwise zxing-wasm (iOS Safari has no BarcodeDetector). */

export type FrameDetector = {
  kind: "native" | "zxing";
  detect: (frame: HTMLCanvasElement) => Promise<string | null>;
};

const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];

type NativeDetector = { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type NativeDetectorClass = {
  new (options: { formats: string[] }): NativeDetector;
  getSupportedFormats: () => Promise<string[]>;
};

/** Digits only, 6–14 long (EAN-8/13, UPC-A/E, GTIN-14), or null. */
export function normaliseBarcode(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 6 && digits.length <= 14 ? digits : null;
}

async function nativeDetector(): Promise<FrameDetector | null> {
  const Native = (globalThis as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
  if (!Native?.getSupportedFormats) return null;
  const supported = await Native.getSupportedFormats().catch(() => [] as string[]);
  if (!supported.includes("ean_13")) return null;
  const detector = new Native({ formats: NATIVE_FORMATS.filter((f) => supported.includes(f)) });
  return {
    kind: "native",
    detect: async (frame) => (await detector.detect(frame))[0]?.rawValue ?? null,
  };
}

async function zxingDetector(): Promise<FrameDetector> {
  const [{ prepareZXingModule, readBarcodes }, { default: wasmUrl }] = await Promise.all([
    import("zxing-wasm/reader"),
    import("zxing-wasm/reader/zxing_reader.wasm?url"),
  ]);
  // Serve the wasm from our own build rather than zxing's default CDN.
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) =>
        path.endsWith(".wasm") ? wasmUrl : prefix + path,
    },
  });
  return {
    kind: "zxing",
    detect: async (frame) => {
      const ctx = frame.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      const image = ctx.getImageData(0, 0, frame.width, frame.height);
      const results = await readBarcodes(image, {
        formats: ["EAN13", "EAN8", "UPCA", "UPCE"],
        tryHarder: true,
        maxNumberOfSymbols: 1,
      });
      return results.find((r) => r.isValid)?.text ?? null;
    },
  };
}

export async function pickDetector(): Promise<FrameDetector> {
  return (await nativeDetector()) ?? zxingDetector();
}
