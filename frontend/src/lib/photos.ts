import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "./api";
import { env } from "./env";
import { resizeImage } from "./image";
import { qk } from "./queries";
import { supabase } from "./supabase";
import type { Photo, Pose, UploadTicket } from "./types";

export type NewPhoto = { file: Blob; pose: Pose; takenAt: string; note: string | null };

export async function uploadPhoto(
  p: NewPhoto,
  resize: (f: Blob) => Promise<Blob> = resizeImage,
): Promise<Photo> {
  const blob = await resize(p.file);
  const ticket = await api<UploadTicket>("/photos/upload-url", { method: "POST" });
  const { error } = await supabase.storage
    .from(env.photoBucket)
    .uploadToSignedUrl(ticket.path, ticket.token, blob, { contentType: "image/jpeg" });
  if (error) throw new ApiError(0, "Photo upload failed. Please try again.");
  return api<Photo>("/photos", {
    method: "POST",
    json: { photo_id: ticket.photo_id, taken_at: p.takenAt, pose: p.pose, note: p.note },
  });
}

export function useUploadPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: NewPhoto) => uploadPhoto(p),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["photos"] });
      void qc.invalidateQueries({ queryKey: ["achievements"] });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}

export function latestByPose(photos: Photo[]): Partial<Record<Pose, Photo>> {
  const out: Partial<Record<Pose, Photo>> = {};
  for (const photo of photos) {
    const current = out[photo.pose];
    if (!current || photo.taken_at > current.taken_at) out[photo.pose] = photo;
  }
  return out;
}
