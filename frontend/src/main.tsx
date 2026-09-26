import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import "./index.css";
import { ApiError, setTokenGetter, setUnauthorizedHandler } from "./lib/api";
import { supabase } from "./lib/supabase";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, error) =>
        !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
});

setTokenGetter(async () => (await supabase.auth.getSession()).data.session?.access_token ?? null);
setUnauthorizedHandler(() => {
  if (window.location.pathname.startsWith("/sign-in")) return;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  void supabase.auth.signOut().finally(() => window.location.assign(`/sign-in?next=${next}`));
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
