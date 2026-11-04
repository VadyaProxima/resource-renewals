import { useQuery } from "@tanstack/react-query";
import type { Resource } from "@renewals/contracts";
import { api } from "@/shared/api";
export const useResources = () =>
  useQuery({
    queryKey: ["resources"],
    queryFn: ({ signal }) => api<Resource[]>("/resources", { signal }),
    refetchInterval: 2000,
  });
