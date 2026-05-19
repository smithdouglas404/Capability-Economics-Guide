import { useQuery } from "@tanstack/react-query";

export type ServiceStatus = "ok" | "degraded" | "down" | "not_configured" | "initializing";

export interface ServiceHealth {
  service: string;
  status: ServiceStatus;
  latencyMs: number | null;
  lastError: string | null;
  checkedAt: string;
}

export interface ServicesHealthResponse {
  overall: ServiceStatus;
  services: ServiceHealth[];
  generatedAt: string;
}

const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");

export function useServiceHealth() {
  return useQuery<ServicesHealthResponse>({
    queryKey: ["service-health"],
    queryFn: async () => {
      const res = await fetch(`${apiBase}/api/health/services`);
      if (!res.ok) throw new Error(`/api/health/services → ${res.status}`);
      return res.json();
    },
    refetchInterval: 60_000,
    staleTime: 55_000,
    retry: 1,
  });
}
