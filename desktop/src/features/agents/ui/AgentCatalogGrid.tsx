import * as React from "react";
import { Search, Users } from "lucide-react";
import type { AgentPersona } from "@/shared/api/types";
import { effectiveAgentDescription } from "../lib/agentDescription";
import { isCatalogPersonaSelected } from "../lib/catalog";
import type { CatalogTeam } from "../lib/teamCatalogRelay";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { IdentityCardSkeleton } from "@/shared/ui/identity-card-skeleton";
import { AgentIdentityCard } from "./AgentIdentityCard";
import { IDENTITY_CARD_GRID_CLASS } from "./UnifiedAgentsSection";
import {
  catalogTeamKey,
  type CatalogSelection,
} from "./CommunityCatalogDialog";

type CatalogGridProps = {
  personas: AgentPersona[];
  teams: CatalogTeam[];
  personasLoading: boolean;
  teamsLoading: boolean;
  personasError: Error | null;
  teamsError: Error | null;
  onRetryPersonas: () => void;
  onRetryTeams: () => void;
  onSelect: (selection: CatalogSelection) => void;
};

/** Relay-confirmed catalog, using the same identity cards as the local library. */
export function AgentCatalogGrid(props: CatalogGridProps) {
  const [search, setSearch] = React.useState("");
  const query = search.trim().toLocaleLowerCase();
  const personas = props.personas.filter((persona) =>
    `${persona.displayName} ${effectiveAgentDescription(persona) ?? ""}`
      .toLocaleLowerCase()
      .includes(query),
  );
  const teams = props.teams.filter((team) =>
    `${team.name} ${team.description ?? ""}`
      .toLocaleLowerCase()
      .includes(query),
  );
  const loading = props.personasLoading || props.teamsLoading;
  return (
    <section className="space-y-6" data-testid="agents-browse-grid">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-label="Search agents and teams"
          className="h-12 rounded-blockui-md pl-12"
          placeholder="Search agents and teams"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {props.personasError ? (
        <CatalogError
          label="agents"
          error={props.personasError}
          onRetry={props.onRetryPersonas}
        />
      ) : null}
      {props.teamsError ? (
        <CatalogError
          label="teams"
          error={props.teamsError}
          onRetry={props.onRetryTeams}
        />
      ) : null}
      {loading ? (
        <div
          aria-label="Loading catalog"
          role="status"
          className={IDENTITY_CARD_GRID_CLASS}
        >
          {[0, 1, 2].map((key) => (
            <IdentityCardSkeleton key={key} />
          ))}
        </div>
      ) : null}
      {personas.length > 0 ? (
        <div className={IDENTITY_CARD_GRID_CLASS}>
          {personas.map((persona) => (
            <AgentIdentityCard
              key={persona.id}
              dataTestId={`community-catalog-agent-${persona.id}`}
              ariaLabel={`Review ${persona.displayName}`}
              label={persona.displayName}
              subtitle={effectiveAgentDescription(persona)}
              avatar={
                <ProfileAvatar
                  avatarUrl={persona.avatarUrl}
                  className="size-24 text-base"
                  label={persona.displayName}
                  shape="squircle"
                  untrusted
                />
              }
              statusBadge={
                isCatalogPersonaSelected(persona) ? (
                  <span className="text-xs font-medium text-muted-foreground">
                    Added
                  </span>
                ) : undefined
              }
              onClick={() =>
                props.onSelect({ kind: "persona", id: persona.id })
              }
            />
          ))}
        </div>
      ) : null}
      {teams.length > 0 ? (
        <section className="space-y-4" aria-label="Shared teams">
          <h2 className="text-base font-semibold">Teams</h2>
          <div className={IDENTITY_CARD_GRID_CLASS}>
            {teams.map((team) => (
              <AgentIdentityCard
                key={catalogTeamKey(team)}
                dataTestId={`community-catalog-team-${catalogTeamKey(team)}`}
                ariaLabel={`Review ${team.name}`}
                label={team.name}
                subtitle={team.description || `${team.members.length} members`}
                avatar={
                  <Users
                    aria-hidden="true"
                    className="size-12 text-muted-foreground"
                  />
                }
                statusBadge={
                  team.localTeam ? (
                    <span className="text-xs font-medium text-muted-foreground">
                      Added
                    </span>
                  ) : undefined
                }
                onClick={() =>
                  props.onSelect({ kind: "team", key: catalogTeamKey(team) })
                }
              />
            ))}
          </div>
        </section>
      ) : null}
      {!loading &&
      !props.personasError &&
      !props.teamsError &&
      personas.length === 0 &&
      teams.length === 0 ? (
        <div
          className="rounded-blockui-lg border border-dashed border-border p-6 text-center"
          data-testid="community-catalog-empty-state"
        >
          <h2 className="text-base font-semibold">
            {query ? "No matches" : "Nothing shared yet"}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {query
              ? "Try a different name or description."
              : "Agents and teams shared with this community will appear here."}
          </p>
        </div>
      ) : null}
    </section>
  );
}

function CatalogError({
  label,
  error,
  onRetry,
}: {
  label: string;
  error: Error;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-4 rounded-blockui-lg border border-destructive/30 p-6"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium">Couldn't load {label}</p>
        <p className="mt-2 break-words text-xs text-muted-foreground">
          {error.message}
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry {label}
      </Button>
    </div>
  );
}
