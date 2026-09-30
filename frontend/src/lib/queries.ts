import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type {
  BodyEntry,
  CustomFoodInput,
  Estimate,
  EstimateParams,
  Food,
  FoodDay,
  FoodLogEntry,
  FoodLogInput,
  FoodLogPatch,
  FoodSearch,
  NutritionSettings,
  NutritionSettingsInput,
  QuickAddInput,
  Targets,
  TargetsInput,
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
  foodDay: (day: string) => ["food-day", day] as const,
  foodSearch: (q: string, external: boolean) => ["food-search", q, external] as const,
  myFoods: ["my-foods"] as const,
  nutritionSettings: ["nutrition-settings"] as const,
  targets: ["nutrition-targets"] as const,
  estimate: (p: EstimateParams) =>
    ["nutrition-estimate", p.mode, p.activity_level, p.deficit_pct, p.protein_g_per_kg] as const,
};

export function invalidateNutrition(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ["food-day"] });
  void qc.invalidateQueries({ queryKey: qk.dashboard });
}

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

// --- Nutrition -------------------------------------------------------------------------------

export function useFoodDay(day: string) {
  return useQuery({
    queryKey: qk.foodDay(day),
    queryFn: () => api<FoodDay>(`/food-log?day=${day}`),
  });
}

/** Local matches (own and cached foods) come back fast; `external` also asks OFF and USDA. */
export function useFoodSearch(q: string, external: boolean, enabled = true) {
  const query = q.trim();
  return useQuery({
    queryKey: qk.foodSearch(query, external),
    queryFn: () =>
      api<FoodSearch>(
        `/foods/search?q=${encodeURIComponent(query)}&external=${external ? "true" : "false"}`,
      ),
    enabled: enabled && query.length >= 3,
    staleTime: 10 * 60_000,
  });
}

export function useImportFood() {
  return useMutation({
    mutationFn: (food: Pick<Food, "source" | "source_ref">) =>
      api<Food>("/foods/import", {
        method: "POST",
        json: { source: food.source, source_ref: food.source_ref },
      }),
  });
}

export function useMyFoods() {
  return useQuery({ queryKey: qk.myFoods, queryFn: () => api<Food[]>("/foods/mine") });
}

function invalidateFoods(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: qk.myFoods });
  void qc.invalidateQueries({ queryKey: ["food-search"] });
}

export function useSaveCustomFood() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string | null; body: CustomFoodInput }) =>
      id
        ? api<Food>(`/foods/${id}`, { method: "PUT", json: body })
        : api<Food>("/foods", { method: "POST", json: body }),
    onSuccess: () => invalidateFoods(qc),
  });
}

export function useDeleteCustomFood() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/foods/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidateFoods(qc),
  });
}

function useLogMutation<TVars>(fn: (vars: TVars) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => invalidateNutrition(qc) });
}

export const useLogFood = () =>
  useLogMutation((body: FoodLogInput) =>
    api<FoodLogEntry>("/food-log", { method: "POST", json: body }),
  );
export const useQuickAdd = () =>
  useLogMutation((body: QuickAddInput) =>
    api<FoodLogEntry>("/food-log/quick", { method: "POST", json: body }),
  );
export const useUpdateLogEntry = () =>
  useLogMutation(({ id, body }: { id: string; body: FoodLogPatch }) =>
    api<FoodLogEntry>(`/food-log/${id}`, { method: "PATCH", json: body }),
  );
export const useDeleteLogEntry = () =>
  useLogMutation((id: string) => api<void>(`/food-log/${id}`, { method: "DELETE" }));

export function useNutritionSettings() {
  return useQuery({
    queryKey: qk.nutritionSettings,
    queryFn: () => api<NutritionSettings>("/nutrition/settings"),
  });
}

export function useSaveNutritionSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NutritionSettingsInput) =>
      api<NutritionSettings>("/nutrition/settings", { method: "PUT", json: body }),
    onSuccess: (saved) => {
      qc.setQueryData(qk.nutritionSettings, saved);
      void qc.invalidateQueries({ queryKey: ["food-search"] });
    },
  });
}

export function useTargets() {
  return useQuery({ queryKey: qk.targets, queryFn: () => api<Targets[]>("/nutrition/targets") });
}

export function useSaveTargets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TargetsInput) =>
      api<Targets>("/nutrition/targets", { method: "POST", json: body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.targets });
      invalidateNutrition(qc);
    },
  });
}

export function useEstimate(params: EstimateParams, enabled = true) {
  return useQuery({
    queryKey: qk.estimate(params),
    queryFn: () => {
      const search = new URLSearchParams({
        mode: params.mode,
        activity_level: params.activity_level,
        protein_g_per_kg: String(params.protein_g_per_kg),
      });
      if (params.deficit_pct != null) search.set("deficit_pct", String(params.deficit_pct));
      return api<Estimate>(`/nutrition/estimate?${search}`);
    },
    enabled,
    retry: false,
  });
}
