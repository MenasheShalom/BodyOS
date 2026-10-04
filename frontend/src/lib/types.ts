export type Sex = "male" | "female";
export type ScaleField =
  | "body_fat_pct"
  | "muscle_mass_kg"
  | "skeletal_muscle_pct"
  | "body_water_pct"
  | "bone_mass_kg"
  | "visceral_fat"
  | "protein_pct"
  | "bmr_kcal"
  | "metabolic_age";
export type TapeField = "waist_cm" | "hips_cm" | "chest_cm" | "neck_cm" | "arm_cm" | "thigh_cm";

export type Profile = {
  height_cm: number;
  sex: Sex;
  date_of_birth: string;
  timezone: string;
  hidden_metrics: ScaleField[];
};

export type BodyEntryInput = { measured_at: string; weight_kg: number; note: string | null } & Record<
  ScaleField,
  number | null
>;
export type BodyEntry = BodyEntryInput & { id: string };

export type MeasurementInput = { measured_at: string; note: string | null } & Record<
  TapeField,
  number | null
>;
export type Measurement = MeasurementInput & { id: string; navy_body_fat_pct: number | null };

export type Pose = "front" | "side" | "back";
export type Photo = { id: string; taken_at: string; pose: Pose; note: string | null; url: string };
export type UploadTicket = { photo_id: string; path: string; token: string };

export type GoalMetric =
  | "weight_kg"
  | "body_fat_pct"
  | "muscle_mass_kg"
  | "fat_mass_kg"
  | "lean_mass_kg"
  | "waist_cm"
  | "navy_body_fat_pct";
export type GoalStatus = "active" | "achieved" | "archived";
export type ProjectionState = "insufficient_data" | "reached" | "not_on_pace" | "on_track";
export type GoalInput = { metric: GoalMetric; target_value: number; target_date: string | null };
export type GoalPatch = Partial<{ target_value: number; target_date: string | null; status: GoalStatus }>;
export type Goal = {
  id: string;
  metric: GoalMetric;
  start_value: number;
  target_value: number;
  start_date: string;
  target_date: string | null;
  status: GoalStatus;
  projection: {
    current: number | null;
    progress_pct: number | null;
    state: ProjectionState;
    projected_date: string | null;
  };
};

export type Point = { date: string; value: number };
export type RangeKey = "1M" | "3M" | "6M" | "1Y" | "ALL";
export type Series = {
  metric: string;
  label: string;
  unit: string;
  points: Point[];
  trend: Point[];
  change: number | null;
  weekly_rate: number | null;
  min: number | null;
  max: number | null;
  latest: number | null;
};

export type MetricSummary = {
  metric: string;
  label: string;
  unit: string;
  latest: number | null;
  change_30d: number | null;
  goal_direction: "up" | "down" | null;
  sparkline: Point[];
};
export type Dashboard = {
  hero: MetricSummary[];
  cards: MetricSummary[];
  secondary: MetricSummary[];
  goals: Goal[];
  nudges: {
    days_since_weigh_in: number | null;
    days_since_photo: number | null;
    no_food_today?: boolean;
  };
  food_today?: FoodToday | null;
  check_in?: Suggestion | null;
};

export type NutrientKey =
  | "energy_kcal"
  | "protein_g"
  | "carbs_g"
  | "fat_g"
  | "fiber_g"
  | "sugar_g"
  | "sat_fat_g"
  | "sodium_mg"
  | "potassium_mg"
  | "calcium_mg"
  | "iron_mg"
  | "magnesium_mg"
  | "zinc_mg"
  | "vit_d_mcg"
  | "vit_b12_mcg"
  | "vit_c_mg"
  | "vit_a_mcg"
  | "folate_mcg";
/** A missing key means "not reported", never zero. */
export type Nutrients = Partial<Record<NutrientKey, number>>;
export type Serving = { label: string; grams: number };
export type FoodSource = "off" | "usda" | "custom" | "recipe";
export type Food = {
  id: string | null;
  source: FoodSource;
  source_ref: string | null;
  barcode: string | null;
  name: string;
  brand: string | null;
  nutrients_per_100g: Nutrients;
  servings: Serving[];
  is_liquid: boolean;
  is_own: boolean;
};
export type FoodSearch = { local: Food[]; external: Food[]; sources_failed: string[] };
export type CustomFoodInput = {
  name: string;
  brand: string | null;
  barcode: string | null;
  servings: Serving[];
  is_liquid: boolean;
} & (
  | { nutrients_per_100g: Nutrients; nutrients_per_serving?: never; serving_grams?: never }
  | { nutrients_per_serving: Nutrients; serving_grams: number; nutrients_per_100g?: never }
);

export type Meal = "breakfast" | "lunch" | "dinner" | "snack";
export type FoodLogEntry = {
  id: string;
  eaten_at: string;
  meal: Meal;
  food_id: string | null;
  name: string;
  grams: number | null;
  serving_label: string | null;
  serving_count: number | null;
  nutrients: Nutrients;
  meal_ref: string | null;
};
export type FoodLogInput = {
  food_id: string;
  grams: number;
  serving_label: string | null;
  serving_count: number | null;
  meal: Meal;
  eaten_at: string;
};
export type QuickAddInput = { name?: string; nutrients: Nutrients; meal: Meal; eaten_at: string };
export type FoodLogPatch = Partial<Omit<FoodLogInput, "food_id">> & {
  name?: string;
  nutrients?: Nutrients;
};

export type MacroTargets = {
  energy_kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
};
export type TargetOrigin = "manual" | "suggested";
export type TargetsInput = MacroTargets & {
  effective_from: string;
  origin: TargetOrigin;
  tdee_at_creation?: number | null;
};
export type Targets = TargetsInput & { tdee_at_creation: number | null };
export type FoodDay = {
  day: string;
  entries: FoodLogEntry[];
  totals: Nutrients;
  coverage: Record<NutrientKey, number>;
  target: Targets | null;
  /** Flagged incomplete: left out of the TDEE and averages. */
  excluded: boolean;
};

export type NutritionMode = "recomp" | "cut" | "maintain" | "lean_bulk";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "very";
export type FoodCountry = "en:israel" | "en:united-states" | "en:united-kingdom" | "en:world";
export type NutritionSettingsInput = {
  mode: NutritionMode;
  deficit_pct: number | null;
  protein_g_per_kg: number;
  activity_level: ActivityLevel;
  check_in_weekday: number;
  food_country: FoodCountry;
};
export type NutritionSettings = NutritionSettingsInput & { configured: boolean };
export type EstimateParams = {
  mode: NutritionMode;
  activity_level: ActivityLevel;
  deficit_pct: number | null;
  protein_g_per_kg: number;
};
export type Estimate = {
  bmr: number;
  tdee: number;
  method: "katch" | "mifflin";
  activity_factor: number;
  weight_kg: number;
  lean_mass_kg: number | null;
  targets: MacroTargets;
};

export type RecentFood = {
  food: Food;
  grams: number;
  serving_label: string | null;
  serving_count: number | null;
  last_eaten_at: string;
};
export type CopyInput = { from_day: string; to_day: string; meal?: Meal; to_meal?: Meal };

export type RecipeItemInput = { food_id: string; grams: number };
export type RecipeInput = {
  name: string;
  servings: number;
  cooked_weight_g: number | null;
  note: string | null;
  items: RecipeItemInput[];
};
export type Recipe = Omit<RecipeInput, "items"> & {
  id: string;
  food_id: string;
  items: (RecipeItemInput & { name: string; brand: string | null; nutrients: Nutrients })[];
  total_grams: number;
  serving_grams: number;
  per_serving: Nutrients;
  incomplete_nutrients: NutrientKey[];
};

export type SavedMealItem = {
  food_id: string | null;
  name: string;
  grams: number | null;
  serving_label: string | null;
  serving_count: number | null;
  nutrients: Nutrients;
};
export type SavedMeal = { id: string; name: string; items: SavedMealItem[]; totals: Nutrients };

export type FoodToday = {
  energy_kcal: number;
  protein_g: number;
  target_kcal: number | null;
  target_protein_g: number | null;
  entries: number;
};
export type TdeeWeek = {
  day: string;
  observed: number | null;
  tdee: number;
  intake: number | null;
};
export type Tdee = {
  tdee: number;
  confidence: number | null;
  /** False while the estimate is still the BMR × activity starting guess. */
  has_data: boolean;
  eligible_days: number;
  start_tdee: number;
  check_in_weekday: number;
  weekly: TdeeWeek[];
};
export type Suggestion = {
  week_start: string;
  tdee: number;
  confidence: number | null;
  targets: MacroTargets;
  current: MacroTargets | null;
  capped: boolean;
  warning: string | null;
};
export type MicroStatus = "low" | "ok" | "over_limit" | "not_enough_data" | "no_reference";
export type Micro = {
  key: NutrientKey;
  average: number | null;
  reference: number | null;
  kind: "target" | "limit" | null;
  coverage: number;
  status: MicroStatus;
};
export type Micros = { window: 7 | 28; days_counted: number; nutrients: Micro[] };
export type FoodDaySummary = {
  day: string;
  energy_kcal: number;
  protein_g: number;
  entries: number;
  excluded: boolean;
};
