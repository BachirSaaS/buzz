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
