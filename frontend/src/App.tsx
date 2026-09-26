import { Navigate, Route, Routes } from "react-router";
import { RequireAuth } from "./auth/RequireAuth";
import { RequireProfile } from "./auth/RequireProfile";
import { AppLayout } from "./components/AppLayout";
import { Goals } from "./pages/Goals";
import { History } from "./pages/History";
import { Home } from "./pages/Home";
import { More } from "./pages/More";
import { Onboarding } from "./pages/Onboarding";
import { PhotoCompare } from "./pages/PhotoCompare";
import { Photos } from "./pages/Photos";
import { Settings } from "./pages/Settings";
import { SignIn } from "./pages/SignIn";
import { Trends } from "./pages/Trends";

export function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignIn />} />
      <Route element={<RequireAuth />}>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route
          element={
            <RequireProfile>
              <AppLayout />
            </RequireProfile>
          }
        >
          <Route index element={<Home />} />
          <Route path="trends" element={<Trends />} />
          <Route path="more" element={<More />} />
          <Route path="history" element={<History />} />
          <Route path="goals" element={<Goals />} />
          <Route path="photos" element={<Photos />} />
          <Route path="photos/compare" element={<PhotoCompare />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
