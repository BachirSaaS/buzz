import { useId, useRef } from "react";
import { ChevronRight, Folder, Globe, ShieldCheck } from "lucide-react";
import type { AgentSecurityPolicy } from "@/shared/api/types";
import { RequiredSecurityConnections } from "./RequiredSecurityConnections";
import { Switch } from "@/shared/ui/switch";
import { SecurityRuleList } from "./SecurityRuleList";

export function normalizeSecurityDraft(
  value: AgentSecurityPolicy | null,
): AgentSecurityPolicy | null {
  if (!value) return null;
  const clean = (items: string[]) => [
    ...new Set(items.map((v) => v.trim()).filter(Boolean)),
  ];
  return {
    ...value,
    writable_roots:
      value.writable_roots === null ? null : clean(value.writable_roots),
    denied_reads: clean(value.denied_reads),
    denied_writes: clean(value.denied_writes),
    environment: clean(value.environment),
    network:
      value.network.mode === "allowlist"
        ? { mode: "allowlist", destinations: clean(value.network.destinations) }
        : value.network,
  };
}

/** Early draft feedback only; native validation remains authoritative on Save. */
export function securityDraftError(
  draft: AgentSecurityPolicy | null,
): string | null {
  const value = normalizeSecurityDraft(draft);
  if (!value) return null;
  if (value.writable_roots?.length === 0)
    return "Add at least one folder this agent can change.";
  const paths = [
    ...(value.writable_roots ?? []),
    ...value.denied_reads,
    ...value.denied_writes,
  ];
  if (
    paths.some(
      (path) => !path.startsWith("/") || path.split("/").includes(".."),
    )
  ) {
    return "Use full paths beginning with /, without .. segments.";
  }
  if (
    value.environment.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
  ) {
    return "Environment variables must be names only, such as API_KEY.";
  }
  if (
    value.network.mode === "allowlist" &&
    value.network.destinations.length === 0
  ) {
    return "Add an allowed domain, or choose Blocked internet access.";
  }
  return null;
}

/** Compact configured-policy summary, independent of live protection status. */
export function securityPolicySummary(
  value: AgentSecurityPolicy | null,
): string {
  if (!value) return "Protection off";
  const folderCount =
    value.writable_roots?.filter((path) => path.trim()).length ?? 0;
  const domainCount =
    value.network.mode === "allowlist"
      ? value.network.destinations.filter((host) => host.trim()).length
      : 0;
  const folders =
    value.writable_roots === null
      ? "Unrestricted file changes"
      : `${folderCount} writable folder${folderCount === 1 ? "" : "s"}`;
  const network =
    value.network.mode === "allowlist"
      ? `${domainCount} allowed domain${domainCount === 1 ? "" : "s"}`
      : value.network.mode === "unrestricted"
        ? "Unrestricted internet"
        : "Internet blocked";
  return `${folders} · ${network}`;
}

const initial: AgentSecurityPolicy = {
  schema_version: 1,
  writable_roots: [],
  denied_reads: [],
  denied_writes: [],
  network: { mode: "deny_all" },
  environment: [],
};

/** Controlled draft: Cancel writes nothing; the parent’s atomic Save owns changes. */
export function AgentSecurityField({
  value,
  onChange,
  disabled,
  availability,
  status,
  suggestedDomains = [],
  connectionsLoading = false,
  connectionsError = false,
}: {
  value: AgentSecurityPolicy | null;
  onChange: (value: AgentSecurityPolicy | null) => void;
  disabled: boolean;
  availability: "available" | "unsupported" | "unknown";
  status?: string;
  suggestedDomains?: string[];
  connectionsLoading?: boolean;
  connectionsError?: boolean;
}) {
  const id = useId();
  const selectedDomains = useRef<string[] | null>(null);
  if (value?.network.mode === "allowlist")
    selectedDomains.current = value.network.destinations;
  const patch = (change: Partial<AgentSecurityPolicy>) =>
    onChange({ ...(value ?? initial), ...change });
  const list = (
    label: string,
    key: "writable_roots" | "denied_reads" | "denied_writes" | "environment",
    description: string,
    addLabel: string,
  ) => (
    <SecurityRuleList
      label={label}
      description={description}
      values={value?.[key] ?? []}
      onChange={(items) => patch({ [key]: items })}
      disabled={disabled}
      placeholder={
        key === "environment" ? "VARIABLE_NAME" : "/Users/you/Projects/example"
      }
      addLabel={addLabel}
    />
  );
  return (
    <section className="space-y-5" aria-label="Agent security">
      <div className="flex items-start gap-3 rounded-xl border bg-muted/20 p-4">
        <ShieldCheck
          className="mt-0.5 size-5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1 space-y-1">
          <label htmlFor={`${id}-enabled`} className="text-sm font-medium">
            Enable protection
          </label>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Limit file changes, internet access, and inherited settings on this
            Mac.
          </p>
          {status && (
            <p className="text-xs text-muted-foreground" role="status">
              Current status: {status}
            </p>
          )}
        </div>
        <Switch
          id={`${id}-enabled`}
          checked={value !== null}
          disabled={
            disabled || (availability !== "available" && value === null)
          }
          onCheckedChange={(enabled) =>
            onChange(enabled ? { ...initial } : null)
          }
        />
      </div>
      {availability !== "available" && (
        <p className="text-xs text-muted-foreground">
          {availability === "unknown"
            ? "Checking whether this runtime supports protection…"
            : "Protection is available for local Buzz Agent on macOS. Saved protection must be removed before using an unsupported runtime."}
        </p>
      )}
      {value && (
        <>
          <section className="space-y-3" aria-labelledby={`${id}-files`}>
            <h3
              id={`${id}-files`}
              className="flex items-center gap-2 text-sm font-semibold"
            >
              <Folder
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
              Files
            </h3>
            {value.writable_roots === null ? (
              <div className="space-y-2">
                <p className="text-sm">
                  This agent can change files anywhere it normally has access.
                </p>
                <button
                  type="button"
                  disabled={disabled}
                  className="text-sm text-primary underline underline-offset-4"
                  onClick={() => patch({ writable_roots: [] })}
                >
                  Limit changes to selected folders
                </button>
              </div>
            ) : (
              list(
                "Folders the agent can change",
                "writable_roots",
                "Other files remain readable unless you block them under Advanced. Use existing full folder paths.",
                "Add folder",
              )
            )}
          </section>
          <section
            className="space-y-3 border-t pt-4"
            aria-labelledby={`${id}-internet`}
          >
            <h3
              id={`${id}-internet`}
              className="flex items-center gap-2 text-sm font-semibold"
            >
              <Globe
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
              Internet
            </h3>
            <label className="block space-y-2 text-sm">
              <span className="block font-medium">Internet access</span>
              <select
                className="block h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                disabled={disabled || connectionsLoading}
                value={value.network.mode}
                onChange={(event) =>
                  patch({
                    network:
                      event.target.value === "allowlist"
                        ? {
                            mode: "allowlist",
                            destinations: selectedDomains.current ?? [
                              ...suggestedDomains,
                            ],
                          }
                        : {
                            mode: event.target.value as
                              | "deny_all"
                              | "unrestricted",
                          },
                  })
                }
              >
                <option value="deny_all">Blocked</option>
                <option value="allowlist">Selected domains</option>
                <option value="unrestricted">Unrestricted</option>
              </select>
            </label>
            {connectionsLoading && (
              <p className="text-xs text-muted-foreground">
                Finding relay and model connection domains…
              </p>
            )}
            {connectionsError && (
              <p className="text-xs text-muted-foreground">
                Couldn’t verify required connections. Close and reopen this
                editor to retry before saving selected domains.
              </p>
            )}
            {value.network.mode === "deny_all" && (
              <p className="text-xs text-muted-foreground">
                Online model providers and Buzz connections need internet
                access.
              </p>
            )}
            {value.network.mode === "allowlist" && (
              <>
                <RequiredSecurityConnections domains={suggestedDomains} />
                <SecurityRuleList
                  label="Additional allowed domains"
                  description="Optional access for tools and other services. Global security defaults cannot remove the required connections above."
                  values={value.network.destinations.filter(
                    (domain) =>
                      !suggestedDomains.includes(domain.trim().toLowerCase()),
                  )}
                  onChange={(destinations) =>
                    patch({
                      network: {
                        mode: "allowlist",
                        destinations: [...suggestedDomains, ...destinations],
                      },
                    })
                  }
                  disabled={disabled}
                  placeholder="api.example.com"
                  addLabel="Add domain"
                />
              </>
            )}
          </section>
          <details className="group border-t pt-4">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 rounded-sm text-sm font-medium focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              <ChevronRight
                className="size-4 shrink-0 transition-transform group-open:rotate-90"
                aria-hidden="true"
              />
              Advanced
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                Blocked paths & environment
              </span>
            </summary>
            <div className="space-y-5 pt-4">
              {list(
                "Files and folders the agent cannot read",
                "denied_reads",
                "Block access to specific existing files or folders.",
                "Block a path",
              )}
              {list(
                "Files and folders the agent cannot change",
                "denied_writes",
                "Protect specific files, including those inside an allowed folder.",
                "Protect a path",
              )}
              {list(
                "Environment variables",
                "environment",
                "Pass additional settings from Buzz to this agent. Names only; values are never saved here.",
                "Add variable",
              )}
              <p className="text-xs leading-relaxed text-muted-foreground">
                This experiment does not yet guarantee cleanup of deliberately
                detached processes.
              </p>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
