import type { Photo, Pose } from "../../lib/types";

const POSES: Pose[] = ["front", "side", "back"];

/** The day's latest photo of each pose, front first: what an estimate is made from. */
export function photosForEstimate(photos: Photo[]): Photo[] {
  return POSES.flatMap((pose) => {
    const ofPose = photos.filter((p) => p.pose === pose);
    return ofPose.length ? [ofPose.reduce((a, b) => (a.taken_at > b.taken_at ? a : b))] : [];
  });
}
