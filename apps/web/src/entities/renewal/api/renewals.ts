import { useQuery } from "@tanstack/react-query";
import type { Renewal, RenewalDetail } from "@renewals/contracts";
import { api } from "@/shared/api";
export const useRenewals = () =>
  useQuery({
    queryKey: ["renewals"],
    queryFn: ({ signal }) => api<Renewal[]>("/renewals", { signal }),
    refetchInterval: 2000,
  });
export const useRenewal = (id: string) =>
  useQuery({
    queryKey: ["renewal", id],
    queryFn: ({ signal }) => api<RenewalDetail>(`/renewals/${id}`, { signal }),
    refetchInterval: 2000,
  });
