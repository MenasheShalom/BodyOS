export const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54321",
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "public-anon-key",
  apiUrl: import.meta.env.VITE_API_URL ?? "http://localhost:8000",
  photoBucket: "progress-photos",
};
