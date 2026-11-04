import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { User } from "@renewals/contracts";
import { api, ApiError } from "@/shared/api";
export async function updateSession(client: QueryClient, user: User | null) {
  await client.cancelQueries();
  client.removeQueries({
    predicate: (query) => query.queryKey[0] !== "session",
  });
  client.setQueryData(["session"], user);
}
export function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: async ({ signal }) => {
      try {
        return await api<User>("/auth/me", { signal });
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    retry: false,
    staleTime: 60000,
  });
}
