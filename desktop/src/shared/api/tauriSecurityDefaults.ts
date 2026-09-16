import { invokeTauri } from "@/shared/api/tauri";
import type { AgentSecurityPolicy } from "@/shared/api/types";

/** Device-local defaults; never included in shared agent definitions. */
export interface SecurityDefaults {
  experimental_enabled: boolean;
  policy: AgentSecurityPolicy | null;
}

export const getSecurityDefaults = () =>
  invokeTauri<SecurityDefaults>("get_agent_security_defaults");

export const setSecurityDefaults = (settings: SecurityDefaults) =>
  invokeTauri<SecurityDefaults>("set_agent_security_defaults", { settings });
