import { useEffect, useState } from "react";
import { useFoodSearch } from "./queries";
import type { Food } from "./types";

// Open Food Facts allows about 10 searches a minute, so the database is only asked once the
// user pauses or presses Enter. Own and cached foods are searched as they type.
export const EXTERNAL_DELAY_MS = 800;

export type CombinedSearch = {
  query: string;
  /** Search the database now (Enter). */
  submit: () => void;
  mine: Food[];
  found: Food[];
  failed: string[];
  searching: boolean;
  error: boolean;
};

export function useCombinedFoodSearch(q: string): CombinedSearch {
  const query = q.trim();
  const [submitted, setSubmitted] = useState("");
  useEffect(() => {
    if (query.length < 3) return;
    const timer = setTimeout(() => setSubmitted(query), EXTERNAL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const external = useFoodSearch(submitted, true, submitted === query);
  const local = useFoodSearch(query, false);
  const ready = submitted === query && external.data != null;
  return {
    query,
    submit: () => query.length >= 3 && setSubmitted(query),
    mine: (ready ? external.data?.local : local.data?.local) ?? [],
    found: ready ? (external.data?.external ?? []) : [],
    failed: ready ? (external.data?.sources_failed ?? []) : [],
    searching: query.length >= 3 && !ready && !(submitted === query && external.isError),
    error: submitted === query && external.isError,
  };
}
