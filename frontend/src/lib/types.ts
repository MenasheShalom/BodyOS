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
  nudges: { days_since_weigh_in: number | null; days_since_photo: number | null };
};
