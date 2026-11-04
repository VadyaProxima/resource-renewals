import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@/shared/api";
import { updateSession } from "@/entities/session";
import { App } from "./App";
import "./styles.css";
const client = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) =>
        !(error instanceof ApiError && error.status < 500) && count < 2,
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
});
// Expired authentication clears all cached tenant data, including open dialogs.
client.getQueryCache().subscribe((event) => {
  if (
    event.type === "updated" &&
    event.action.type === "error" &&
    event.action.error instanceof ApiError &&
    event.action.error.status === 401 &&
    (event.query.queryKey as readonly unknown[])[0] !== "session"
  ) {
    void updateSession(client, null);
  }
});
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
