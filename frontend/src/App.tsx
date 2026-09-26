import { Navigate, Route, Routes } from "react-router";
import { RequireAuth } from "./auth/RequireAuth";
import { RequireProfile } from "./auth/RequireProfile";
import { AppLayout } from "./components/AppLayout";
import { Home } from "./pages/Home";
import { More } from "./pages/More";
import { Onboarding } from "./pages/Onboarding";
import { Settings } from "./pages/Settings";
import { SignIn } from "./pages/SignIn";

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
          <Route path="more" element={<More />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
