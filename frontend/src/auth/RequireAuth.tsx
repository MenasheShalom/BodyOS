import { Navigate, Outlet, useLocation } from "react-router";
import { Spinner } from "../components/EmptyState";
import { useAuth } from "./AuthProvider";

export function RequireAuth() {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner />;
  if (!session) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/sign-in?next=${next}`} replace />;
  }
  return <Outlet />;
}
