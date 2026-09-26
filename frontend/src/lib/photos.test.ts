import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.fn();
const uploadToSignedUrl = vi.fn();
vi.mock("./api", async (orig) => ({
  ...(await orig<typeof import("./api")>()),
  api: (...a: unknown[]) => api(...a),
}));
vi.mock("./supabase", () => ({
  supabase: {
    storage: { from: () => ({ uploadToSignedUrl: (...a: unknown[]) => uploadToSignedUrl(...a) }) },
  },
}));

import { latestByPose, uploadPhoto } from "./photos";

const resize = vi.fn(async () => new Blob(["small"], { type: "image/jpeg" }));
const photo = {
  file: new Blob(["big"]),
  pose: "front" as const,
  takenAt: "2026-02-28T07:00:00.000Z",
  note: null,
};

describe("uploadPhoto", () => {
  beforeEach(() => {
    api.mockReset();
    uploadToSignedUrl.mockReset();
  });

  it("resizes, uploads to the signed URL, then registers the photo", async () => {
    api
      .mockResolvedValueOnce({ photo_id: "p1", path: "u/p1.jpg", token: "tok" })
      .mockResolvedValueOnce({ id: "p1" });
    uploadToSignedUrl.mockResolvedValue({ data: {}, error: null });
    await uploadPhoto(photo, resize);
    expect(resize).toHaveBeenCalledWith(photo.file);
    expect(uploadToSignedUrl).toHaveBeenCalledWith("u/p1.jpg", "tok", expect.any(Blob), {
      contentType: "image/jpeg",
    });
    expect(api).toHaveBeenLastCalledWith("/photos", {
      method: "POST",
      json: { photo_id: "p1", taken_at: photo.takenAt, pose: "front", note: null },
    });
  });

  it("does not register the photo when the upload fails", async () => {
    api.mockResolvedValueOnce({ photo_id: "p1", path: "u/p1.jpg", token: "tok" });
    uploadToSignedUrl.mockResolvedValue({ data: null, error: { message: "network" } });
    await expect(uploadPhoto(photo, resize)).rejects.toThrow("Photo upload failed");
    expect(api).toHaveBeenCalledTimes(1);
  });
});

describe("latestByPose", () => {
  it("keeps the newest photo for each pose", () => {
    const photos = [
      { id: "b", pose: "front", taken_at: "2026-02-20T07:00:00Z" },
      { id: "a", pose: "front", taken_at: "2026-02-27T07:00:00Z" },
      { id: "c", pose: "side", taken_at: "2026-02-10T07:00:00Z" },
    ] as never;
    const latest = latestByPose(photos);
    expect(latest.front?.id).toBe("a");
    expect(latest.side?.id).toBe("c");
    expect(latest.back).toBeUndefined();
  });
});
