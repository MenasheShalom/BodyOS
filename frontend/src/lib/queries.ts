import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type {
  BodyEntry,
  BodyEntryInput,
  Dashboard,
  Goal,
  GoalInput,
  GoalPatch,
  Measurement,
  MeasurementInput,
  Photo,
  Pose,
  Profile,
  RangeKey,
  Series,
} from "./types";

export const qk = {
  profile: ["profile"] as const,
  bodyEntries: ["body-entries"] as const,
  measurements: ["measurements"] as const,
  goals: ["goals"] as const,
  dashboard: ["dashboard"] as const,
  photos: (pose?: Pose) => ["photos", pose ?? "all"] as const,
  series: (metric: string, range: RangeKey) => ["series", metric, range] as const,
  navy: (w: number, n: number, h: number | null) => ["navy", w, n, h] as const,
};

export function invalidateDerived(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ["series"] });
  void qc.invalidateQueries({ queryKey: qk.dashboard });
  void qc.invalidateQueries({ queryKey: qk.goals });
}

export function useProfile() {
  return useQuery({ queryKey: qk.profile, queryFn: () => api<Profile>("/me/profile") });
}

export function useSaveProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (profile: Profile) => api<Profile>("/me/profile", { method: "PUT", json: profile }),
    onSuccess: (saved) => {
      qc.setQueryData(qk.profile, saved);
      invalidateDerived(qc);
    },
  });
}

function crudHooks<T, TCreate, TPatch>(path: string, listKey: readonly string[]) {
  return {
    useList: () => useQuery({ queryKey: listKey, queryFn: () => api<T[]>(path) }),
    useCreate: () => {
      const qc = useQueryClient();
      return useMutation({
        mutationFn: (body: TCreate) => api<T>(path, { method: "POST", json: body }),
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: listKey });
          invalidateDerived(qc);
        },
      });
    },
    useUpdate: () => {
      const qc = useQueryClient();
      return useMutation({
        mutationFn: ({ id, body }: { id: string; body: TPatch }) =>
          api<T>(`${path}/${id}`, { method: "PATCH", json: body }),
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: listKey });
          invalidateDerived(qc);
        },
      });
    },
    useDelete: () => {
      const qc = useQueryClient();
      return useMutation({
        mutationFn: (id: string) => api<void>(`${path}/${id}`, { method: "DELETE" }),
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: listKey });
          invalidateDerived(qc);
        },
      });
    },
  };
}

export const bodyEntries = crudHooks<BodyEntry, BodyEntryInput, Partial<BodyEntryInput>>(
  "/body-entries",
  qk.bodyEntries,
);
export const measurements = crudHooks<Measurement, MeasurementInput, Partial<MeasurementInput>>(
  "/measurements",
  qk.measurements,
);
export const goals = crudHooks<Goal, GoalInput, GoalPatch>("/goals", qk.goals);

export function usePhotos(pose?: Pose) {
  return useQuery({
    queryKey: qk.photos(pose),
    queryFn: () => api<Photo[]>(pose ? `/photos?pose=${pose}` : "/photos"),
    staleTime: 30 * 60_000, // signed URLs last 60 minutes
  });
}

export function useDeletePhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/photos/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["photos"] });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}

export function useSeries(metric: string, range: RangeKey, enabled = true) {
  return useQuery({
    queryKey: qk.series(metric, range),
    queryFn: () => api<Series>(`/series?metric=${encodeURIComponent(metric)}&range=${range}`),
    enabled,
  });
}

export function useDashboard() {
  return useQuery({ queryKey: qk.dashboard, queryFn: () => api<Dashboard>("/dashboard") });
}

export function useNavyPreview(waist: number | null, neck: number | null, hips: number | null) {
  return useQuery({
    queryKey: qk.navy(waist ?? 0, neck ?? 0, hips),
    queryFn: () => {
      const params = new URLSearchParams({ waist_cm: String(waist), neck_cm: String(neck) });
      if (hips != null) params.set("hips_cm", String(hips));
      return api<{ navy_body_fat_pct: number | null }>(`/measurements/navy-preview?${params}`);
    },
    enabled: waist != null && neck != null,
    staleTime: Infinity,
  });
}
