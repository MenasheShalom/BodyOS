import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "./api";
import type {
  AiSettings,
  AiStatus,
  BatchEntry,
  BodyEntry,
  CopyInput,
  Meal,
  Micros,
  RecentFood,
  Recipe,
  RecipeInput,
  SavedMeal,
  Suggestion,
  Tdee,
  CustomFoodInput,
  Estimate,
  EstimateParams,
  Food,
  FoodDay,
  FoodDaySummary,
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
  FoodPhotoResult,
  BodyFatEstimate,
  ReportList,
  WeeklyReport,
  GroceriesInput,
  MealPlan,
  MealPlanInput,
  RecipeIdeas,
  SavedMealInput,
  Achievement,
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
  favourites: ["favourites"] as const,
  recentFoods: ["recent-foods"] as const,
  recipes: ["recipes"] as const,
  savedMeals: ["saved-meals"] as const,
  tdee: ["nutrition-tdee"] as const,
  suggestion: ["nutrition-suggestion"] as const,
  micros: (window: number) => ["nutrition-micros", window] as const,
  foodDays: (from: string, to: string) => ["food-days", from, to] as const,
  aiStatus: ["ai-status"] as const,
  reports: ["ai-reports"] as const,
  report: (week: string) => ["ai-report", week] as const,
  bodyFat: ["ai-body-fat"] as const,
  aiSettings: ["ai-settings"] as const,
  achievements: ["achievements"] as const,
  estimate: (p: EstimateParams) =>
    ["nutrition-estimate", p.mode, p.activity_level, p.deficit_pct, p.protein_g_per_kg] as const,
};

export function invalidateNutrition(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ["food-day"] });
  void qc.invalidateQueries({ queryKey: qk.recentFoods });
  // Logging changes the burn estimate, the check-in, averages and the nutrition charts.
  for (const key of [qk.tdee, qk.suggestion, ["nutrition-micros"], ["food-days"], ["series"]]) {
    void qc.invalidateQueries({ queryKey: key });
  }
  void qc.invalidateQueries({ queryKey: qk.dashboard });
  void qc.invalidateQueries({ queryKey: qk.achievements });
}

export function invalidateDerived(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ["series"] });
  void qc.invalidateQueries({ queryKey: qk.dashboard });
  void qc.invalidateQueries({ queryKey: qk.goals });
  void qc.invalidateQueries({ queryKey: qk.achievements });
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

function useLogMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
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
      void qc.invalidateQueries({ queryKey: qk.achievements });
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

// --- Nutrition phase 2: favourites, recent, copy, barcode, recipes, saved meals ------------

export function useFavourites() {
  return useQuery({ queryKey: qk.favourites, queryFn: () => api<Food[]>("/favourites") });
}

export function useSetFavourite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ foodId, favourite }: { foodId: string; favourite: boolean }) =>
      api<void>(`/favourites/${foodId}`, { method: favourite ? "PUT" : "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.favourites }),
  });
}

export function useRecentFoods() {
  return useQuery({ queryKey: qk.recentFoods, queryFn: () => api<RecentFood[]>("/foods/recent") });
}

export const useCopyEntries = () =>
  useLogMutation((body: CopyInput) =>
    api<FoodLogEntry[]>("/food-log/copy", { method: "POST", json: body }),
  );

/** Look a barcode up: own or cached food, then Open Food Facts, then USDA. */
export function useBarcodeLookup() {
  return useMutation({
    mutationFn: (code: string) => api<Food>(`/foods/barcode/${encodeURIComponent(code)}`),
  });
}

export function useRecipes() {
  return useQuery({ queryKey: qk.recipes, queryFn: () => api<Recipe[]>("/recipes") });
}

export function useSaveRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: RecipeInput }) =>
      id
        ? api<Recipe>(`/recipes/${id}`, { method: "PUT", json: body })
        : api<Recipe>("/recipes", { method: "POST", json: body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.recipes });
      void qc.invalidateQueries({ queryKey: ["food-search"] });
      void qc.invalidateQueries({ queryKey: qk.achievements });
    },
  });
}

export function useDeleteRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/recipes/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.recipes });
      void qc.invalidateQueries({ queryKey: ["food-search"] });
    },
  });
}

export function useSavedMeals() {
  return useQuery({ queryKey: qk.savedMeals, queryFn: () => api<SavedMeal[]>("/saved-meals") });
}

export function useSaveMealFromLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; day: string; meal: Meal }) =>
      api<SavedMeal>("/saved-meals/from-log", { method: "POST", json: body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.savedMeals }),
  });
}

export function useCreateSavedMeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SavedMealInput) =>
      api<SavedMeal>("/saved-meals", { method: "POST", json: body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.savedMeals }),
  });
}

export function useDeleteSavedMeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/saved-meals/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.savedMeals }),
  });
}

export const useLogSavedMeal = () =>
  useLogMutation(({ id, meal, eaten_at }: { id: string; meal: Meal; eaten_at: string }) =>
    api<FoodLogEntry[]>(`/saved-meals/${id}/log`, { method: "POST", json: { meal, eaten_at } }),
  );

// --- Nutrition phase 3: TDEE, check-in, micronutrients, day flags --------------------------

export function useTdee(enabled = true) {
  return useQuery({
    queryKey: qk.tdee,
    queryFn: () => api<Tdee>("/nutrition/tdee"),
    enabled,
    retry: false,
  });
}

export function useSuggestion() {
  return useQuery({
    queryKey: qk.suggestion,
    queryFn: () => api<Suggestion | null>("/nutrition/suggestion"),
  });
}

export function useDismissSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>("/nutrition/suggestion/dismiss", { method: "POST" }),
    onSuccess: () => {
      qc.setQueryData(qk.suggestion, null);
      void qc.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}

export function useMicros(window: 7 | 28) {
  return useQuery({
    queryKey: qk.micros(window),
    queryFn: () => api<Micros>(`/nutrition/micros?window=${window}`),
  });
}

export const useFlagDay = () =>
  useLogMutation(({ day, excluded }: { day: string; excluded: boolean }) =>
    api<void>(`/food-log/days/${day}/flag`, { method: "PUT", json: { excluded } }),
  );

export function useFoodDays(from: string, to: string) {
  return useQuery({
    queryKey: qk.foodDays(from, to),
    queryFn: () => api<FoodDaySummary[]>(`/food-log/days?from=${from}&to=${to}`),
  });
}

export function useAiStatus() {
  return useQuery({ queryKey: qk.aiStatus, queryFn: () => api<AiStatus>("/ai/status") });
}

export function useAiSettings() {
  return useQuery({ queryKey: qk.aiSettings, queryFn: () => api<AiSettings>("/ai/settings") });
}

export function useSaveAiSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (s: AiSettings) => api<AiSettings>("/ai/settings", { method: "PUT", json: s }),
    onSuccess: (s) => {
      qc.setQueryData(qk.aiSettings, s);
      void qc.invalidateQueries({ queryKey: qk.aiStatus });
    },
  });
}

export function useFoodPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ image, hint }: { image: Blob; hint: string }) => {
      const form = new FormData();
      form.append("image", image, "photo.jpg");
      if (hint.trim()) form.append("hint", hint.trim());
      return api<FoodPhotoResult>("/ai/food-photo", { method: "POST", body: form });
    },
    // Every attempt (even a failed one) can change this month's usage count.
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.aiStatus }),
  });
}

export const useLogBatch = () =>
  useLogMutation((entries: BatchEntry[]) =>
    api<FoodLogEntry[]>("/food-log/batch", { method: "POST", json: { entries } }),
  );

export function useReports(enabled = true) {
  return useQuery({
    queryKey: qk.reports,
    queryFn: () => api<ReportList>("/ai/reports"),
    enabled,
  });
}

export function useReport(week: string) {
  return useQuery({
    queryKey: qk.report(week),
    // 404 means "not written yet", which the page handles as a normal state.
    queryFn: async () => {
      try {
        return await api<WeeklyReport>(`/ai/reports/${week}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
  });
}

export function useWriteReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (week: string) =>
      api<WeeklyReport>(`/ai/reports/${week}`, { method: "POST" }),
    onSuccess: (report) => {
      qc.setQueryData(qk.report(report.week_start), report);
      void qc.invalidateQueries({ queryKey: qk.reports });
      void qc.invalidateQueries({ queryKey: qk.achievements });
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.aiStatus }),
  });
}

export function useBodyFatEstimates(enabled = true) {
  return useQuery({
    queryKey: qk.bodyFat,
    queryFn: () => api<BodyFatEstimate[]>("/ai/body-fat"),
    enabled,
  });
}

function invalidateBodyFat(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: qk.bodyFat });
  void qc.invalidateQueries({ queryKey: ["series", "ai_body_fat_pct"] });
}

export function useEstimateBodyFat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photoIds: string[]) =>
      api<BodyFatEstimate>("/ai/body-fat", { method: "POST", json: { photo_ids: photoIds } }),
    onSuccess: () => invalidateBodyFat(qc),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.aiStatus }),
  });
}

export function useDeleteBodyFat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/ai/body-fat/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidateBodyFat(qc),
  });
}

// --- AI phase 3: meal plans and recipes from groceries ---------------------------------------

export function useMealPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MealPlanInput) =>
      api<MealPlan>("/ai/meal-plan", { method: "POST", json: body }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.aiStatus });
      // the preferences are remembered server-side
      void qc.invalidateQueries({ queryKey: qk.aiSettings });
      // ingredients found on USDA or OFF are now cached foods
      void qc.invalidateQueries({ queryKey: ["food-search"] });
    },
  });
}

export function useRecipeIdeas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GroceriesInput) =>
      api<RecipeIdeas>("/ai/recipes-from-groceries", { method: "POST", json: body }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.aiStatus });
      void qc.invalidateQueries({ queryKey: ["food-search"] });
    },
  });
}

// --- Trophies --------------------------------------------------------------------------------

export function useAchievements(enabled = true) {
  return useQuery({
    queryKey: qk.achievements,
    queryFn: () => api<Achievement[]>("/achievements"),
    enabled,
  });
}

export function useMarkAchievementsSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (keys: string[]) =>
      api<void>("/achievements/seen", { method: "POST", json: { keys } }),
    onMutate: (keys) =>
      qc.setQueryData<Achievement[]>(qk.achievements, (prev) =>
        prev?.map((a) => (keys.includes(a.key) ? { ...a, new: false } : a)),
      ),
  });
}
