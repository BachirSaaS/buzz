import { useMemo } from "react";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { useProjectsQuery } from "@/features/projects/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import { useFeatureEnabled } from "@/shared/features";
import {
  buzzWidgetCatalog,
  canvasWidgets,
} from "@/features/widgets/widgetCatalog";
import { buildWindowCatalog } from "./windowCatalog";

/** Resolve only windows available to the signed-in identity in the active community. */
export function useWindowCatalog() {
  const identity = useIdentityQuery();
  const channels = useChannelsQuery();
  const projectsEnabled = useFeatureEnabled("projects");
  const workflowsEnabled = useFeatureEnabled("workflows");
  const projects = useProjectsQuery(projectsEnabled);
  const pubkeys = useMemo(
    () => [
      ...new Set(
        (channels.data ?? [])
          .filter((c) => c.isMember && !c.archivedAt && c.channelType === "dm")
          .flatMap((c) => c.participantPubkeys),
      ),
    ],
    [channels.data],
  );
  const profiles = useUsersBatchQuery(pubkeys, { enabled: pubkeys.length > 0 });
  const people = useMemo(
    () =>
      pubkeys
        .filter((pubkey) => pubkey !== identity.data?.pubkey)
        .map((pubkey) => {
          const profile = profiles.data?.profiles[pubkey];
          return {
            pubkey,
            displayName: profile?.displayName || profile?.name || null,
            nip05Handle: profile?.nip05Handle ?? null,
            avatarUrl: profile?.avatarUrl ?? null,
            ownerPubkey: profile?.ownerPubkey ?? null,
            isAgent: profile?.isAgent ?? false,
            known: true,
            aliases: [
              profile?.name,
              profile?.displayName,
              profile?.nip05Handle,
            ].filter((name): name is string => Boolean(name)),
            lastMessageAt: Math.max(
              0,
              ...(channels.data ?? [])
                .filter(
                  (c) =>
                    c.channelType === "dm" &&
                    c.isMember &&
                    !c.archivedAt &&
                    c.participantPubkeys.includes(pubkey),
                )
                .map((c) => Date.parse(c.lastMessageAt ?? "") || 0),
            ),
          };
        }),
    [pubkeys, profiles.data, identity.data?.pubkey, channels.data],
  );
  const views = useMemo(
    () =>
      buildWindowCatalog({
        channels: channels.data ?? [],
        profiles: profiles.data?.profiles ?? {},
        currentPubkey: identity.data?.pubkey,
        projects: projects.data ?? [],
        widgets: [...buzzWidgetCatalog, ...canvasWidgets],
        projectsEnabled,
        workflowsEnabled,
      }),
    [
      channels.data,
      profiles.data,
      identity.data?.pubkey,
      projects.data,
      projectsEnabled,
      workflowsEnabled,
    ],
  );
  return {
    views,
    people,
    ready:
      Boolean(identity.data?.pubkey) &&
      channels.isSuccess &&
      (!pubkeys.length || profiles.isSuccess) &&
      (!projectsEnabled || projects.isSuccess),
    error:
      channels.isError ||
      (pubkeys.length > 0 && profiles.isError) ||
      (projectsEnabled && projects.isError),
    retry: () =>
      Promise.all([
        channels.refetch(),
        ...(pubkeys.length ? [profiles.refetch()] : []),
        ...(projectsEnabled ? [projects.refetch()] : []),
      ]),
  };
}
