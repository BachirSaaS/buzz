import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getSecurityDefaults,
  setSecurityDefaults,
} from "@/shared/api/tauriSecurityDefaults";

export const SECURITY_DEFAULTS_QUERY_KEY = ["agent-security-defaults"] as const;

/** The native setting is authoritative for both configuration and creation. */
export function useSecurityDefaultsQuery() {
  return useQuery({
    queryKey: SECURITY_DEFAULTS_QUERY_KEY,
    queryFn: getSecurityDefaults,
    staleTime: 30_000,
  });
}

/** Publish only the successfully persisted, validated native response. */
export function useSaveSecurityDefaultsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setSecurityDefaults,
    scope: { id: "agent-security-defaults" },
    onMutate: async () => {
      await queryClient.cancelQueries({
        queryKey: SECURITY_DEFAULTS_QUERY_KEY,
      });
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(SECURITY_DEFAULTS_QUERY_KEY, settings);
    },
  });
}
