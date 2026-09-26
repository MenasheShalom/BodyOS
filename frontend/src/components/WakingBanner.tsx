import { useEffect, useState } from "react";
import { onSlowRequest } from "../lib/api";

export function WakingBanner() {
  const [slow, setSlow] = useState(false);
  useEffect(() => onSlowRequest(setSlow), []);
  if (!slow) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-3 z-50 mx-auto w-fit rounded-full bg-text px-4 py-2 text-sm text-bg shadow-lg"
    >
      Waking up server… this can take up to a minute.
    </div>
  );
}
