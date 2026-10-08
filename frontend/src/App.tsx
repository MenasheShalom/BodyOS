import { Navigate, Route, Routes } from "react-router";
import { RequireAuth } from "./auth/RequireAuth";
import { RequireProfile } from "./auth/RequireProfile";
import { AppLayout } from "./components/AppLayout";
import { Connect } from "./pages/Connect";
import { Food } from "./pages/Food";
import { FoodEditor } from "./pages/FoodEditor";
import { Goals } from "./pages/Goals";
import { History } from "./pages/History";
import { Home } from "./pages/Home";
import { More } from "./pages/More";
import { MyFoods } from "./pages/MyFoods";
import { Nutrition } from "./pages/Nutrition";
import { NutritionSetup } from "./pages/NutritionSetup";
import { RecipeEditor } from "./pages/RecipeEditor";
import { Recipes } from "./pages/Recipes";
import { SavedMeals } from "./pages/SavedMeals";
import { Onboarding } from "./pages/Onboarding";
import { PhotoCompare } from "./pages/PhotoCompare";
import { Photos } from "./pages/Photos";
import { PlanWithAi } from "./pages/PlanWithAi";
import { ReportDetail } from "./pages/ReportDetail";
import { Reports } from "./pages/Reports";
import { Settings } from "./pages/Settings";
import { Targets } from "./pages/Targets";
import { SignIn } from "./pages/SignIn";
import { Trends } from "./pages/Trends";
import { Training } from "./pages/Training";
import { TrainingSetup } from "./pages/TrainingSetup";
import { Trophies } from "./pages/Trophies";
import { WorkoutToday } from "./pages/WorkoutToday";

export function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignIn />} />
      <Route element={<RequireAuth />}>
        <Route path="/connect" element={<Connect />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route
          element={
            <RequireProfile>
              <AppLayout />
            </RequireProfile>
          }
        >
          <Route index element={<Home />} />
          <Route path="food" element={<Food />} />
          <Route path="trends" element={<Trends />} />
          <Route path="more" element={<More />} />
          <Route path="history" element={<History />} />
          <Route path="goals" element={<Goals />} />
          <Route path="photos" element={<Photos />} />
          <Route path="photos/compare" element={<PhotoCompare />} />
          <Route path="settings" element={<Settings />} />
          <Route path="reports" element={<Reports />} />
          <Route path="trophies" element={<Trophies />} />
          <Route path="training" element={<Training />} />
          <Route path="training/setup" element={<TrainingSetup />} />
          <Route path="training/today" element={<WorkoutToday />} />
          <Route path="reports/:week" element={<ReportDetail />} />
          <Route path="nutrition" element={<Nutrition />} />
          <Route path="nutrition/setup" element={<NutritionSetup />} />
          <Route path="nutrition/targets" element={<Targets />} />
          <Route path="nutrition/foods" element={<MyFoods />} />
          <Route path="nutrition/recipes" element={<Recipes />} />
          <Route path="nutrition/recipes/new" element={<RecipeEditor />} />
          <Route path="nutrition/recipes/:id" element={<RecipeEditor />} />
          <Route path="nutrition/meals" element={<SavedMeals />} />
          <Route path="nutrition/plan" element={<PlanWithAi />} />
          <Route path="nutrition/foods/new" element={<FoodEditor />} />
          <Route path="nutrition/foods/:id" element={<FoodEditor />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
