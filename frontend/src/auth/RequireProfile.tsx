import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { ErrorState, Spinner } from "../components/EmptyState";
import { ApiError } from "../lib/api";
import { useProfile } from "../lib/queries";

export function RequireProfile({ children }: { children: ReactNode }) {
  const profile = useProfile();
  if (profile.isPending) return <Spinner />;
  if (profile.error instanceof ApiError && profile.error.status === 404) {
    return <Navigate to="/onboarding" replace />;
  }
  if (profile.isError) {
    return <ErrorState message={profile.error.message} onRetry={() => void profile.refetch()} />;
  }
  return <>{children}</>;
}
