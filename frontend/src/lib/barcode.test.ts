import { afterEach, describe, expect, it, vi } from "vitest";

const readBarcodes = vi.fn();
vi.mock("zxing-wasm/reader", () => ({ prepareZXingModule: vi.fn(), readBarcodes }));
vi.mock("zxing-wasm/reader/zxing_reader.wasm?url", () => ({ default: "/assets/zxing.wasm" }));

import { normaliseBarcode, pickDetector } from "./barcode";

describe("normaliseBarcode", () => {
  it("keeps 6 to 14 digits", () => {
    expect(normaliseBarcode(" 7290 0000 00017 ")).toBe("7290000000017");
    expect(normaliseBarcode("12345")).toBeNull();
    expect(normaliseBarcode("123456789012345")).toBeNull();
  });
});

describe("pickDetector", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the browser's detector when it reads EAN-13", async () => {
    class BarcodeDetector {
      static getSupportedFormats = async () => ["qr_code", "ean_13", "upc_a"];
      formats: string[];
      constructor(options: { formats: string[] }) {
        this.formats = options.formats;
      }
      detect = async () => [{ rawValue: "7290000000017" }];
    }
    vi.stubGlobal("BarcodeDetector", BarcodeDetector);
    const detector = await pickDetector();
    expect(detector.kind).toBe("native");
    expect(await detector.detect(document.createElement("canvas"))).toBe("7290000000017");
  });

  it("falls back to zxing when the browser can't read EAN-13", async () => {
    vi.stubGlobal("BarcodeDetector", { getSupportedFormats: async () => ["qr_code"] });
    const detector = await pickDetector();
    expect(detector.kind).toBe("zxing");
  });

  it("falls back to zxing without a BarcodeDetector at all", async () => {
    vi.stubGlobal("BarcodeDetector", undefined);
    expect((await pickDetector()).kind).toBe("zxing");
  });
});
