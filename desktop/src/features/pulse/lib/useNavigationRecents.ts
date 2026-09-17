import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useChannelsQuery } from "@/features/channels/hooks";
import { buildDirectMessageIntro } from "@/features/channels/lib/dmParticipantDisplay";
import { useProjectsQuery } from "@/features/projects/hooks";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import { useRelayOrigin } from "@/shared/lib/useRelayOrigin";
import { useHistorySearchState } from "@/shared/hooks/useHistorySearchState";

const CHANGE = "buzz-recent-projects-changed";
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE, callback);
  };
}
function parseRecentProjects(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(value)
      ? value
          .filter(
            (id): id is string => typeof id === "string" && id.length <= 512,
          )
          .slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

/** Community-scoped destinations resolved from live membership and profile data. */
export function useNavigationRecents(projectsEnabled: boolean) {
  const identity = useIdentityQuery();
  const pubkey = identity.data?.pubkey;
  const relay = useRelayOrigin();
  const channels = useChannelsQuery();
  const projects = useProjectsQuery(projectsEnabled);
  const { values } = useHistorySearchState(["projectId"] as const);
  const key =
    relay && pubkey ? `buzz-recent-projects.v1:${relay}:${pubkey}` : null;
  const snapshot = useCallback(() => {
    try {
      return key ? localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  }, [key]);
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const recentIds = useMemo(() => parseRecentProjects(raw), [raw]);
  useEffect(() => {
    const id = values.projectId;
    if (
      !key ||
      !id ||
      !projectsEnabled ||
      !projects.data?.some((project) => project.id === id) ||
      recentIds[0] === id
    )
      return;
    try {
      localStorage.setItem(
        key,
        JSON.stringify(
          [id, ...recentIds.filter((previous) => previous !== id)].slice(0, 8),
        ),
      );
      window.dispatchEvent(new Event(CHANGE));
    } catch {
      toast.error(
        "Could not save recent projects. Your project is still open.",
      );
    }
  }, [key, values.projectId, projectsEnabled, projects.data, recentIds]);
  const recentChannels = useMemo(
    () =>
      (channels.data ?? [])
        .filter((channel) => channel.isMember && !channel.archivedAt)
        .sort((a, b) =>
          (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""),
        ),
    [channels.data],
  );
  const profileKeys = useMemo(
    () => [
      ...new Set([
        ...(pubkey ? [pubkey] : []),
        ...recentChannels
          .slice(0, 20)
          .flatMap((channel) =>
            channel.channelType === "dm" ? channel.participantPubkeys : [],
          ),
      ]),
    ],
    [pubkey, recentChannels],
  );
  const profiles = useUsersBatchQuery(profileKeys, {
    enabled: profileKeys.length > 0,
  });
  const conversations = recentChannels.slice(0, 6).map((channel) => {
    const intro = buildDirectMessageIntro({
      channel,
      currentPubkey: pubkey,
      profiles: profiles.data?.profiles,
    });
    return {
      channel,
      name: intro?.displayName || channel.name,
      person: intro?.participants[0],
    };
  });
  const recentProjects = recentIds.flatMap(
    (id) => projects.data?.find((project) => project.id === id) ?? [],
  );
  return {
    conversations,
    projects: (recentProjects.length
      ? recentProjects
      : (projects.data ?? [])
    ).slice(0, 6),
    hasRecentProjects: recentProjects.length > 0,
    channelsQuery: channels,
    projectsQuery: projects,
    profile: profiles.data?.profiles[pubkey ?? ""],
  };
}
