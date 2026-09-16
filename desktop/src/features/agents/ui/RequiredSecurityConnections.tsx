import { LockKeyhole } from "lucide-react";

/** Connection requirements are displayed separately from optional user rules. */
export function RequiredSecurityConnections({
  domains,
}: {
  domains: string[];
}) {
  if (!domains.length) return null;
  return (
    <section
      className="space-y-2 rounded-lg border bg-muted/30 p-3"
      aria-label="Required connections"
    >
      <h4 className="text-sm font-medium">Required connections</h4>
      <p className="text-xs text-muted-foreground">
        Keeps this agent connected to Buzz and its model provider.
      </p>
      <ul className="space-y-2">
        {domains.map((domain) => (
          <li key={domain} className="flex min-w-0 items-start gap-2 text-xs">
            <LockKeyhole
              className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 break-all font-mono">{domain}</span>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 font-medium">
              Required
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
