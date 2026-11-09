export const API_URL = import.meta.env.DEV
  ? new URL("/api", window.location.origin).toString()
  : import.meta.env.VITE_API_URL || "/api";
