import { getUsersBatch, searchUsers } from "@/shared/api/tauriProfiles";
import type { Channel, UserSearchResult } from "@/shared/api/types";
import type { CommandContext } from "./plan";
import {
  rankCommandRecipients,
  readRecipientAliases,
  recipientSearchTerms,
  type CommandRecipient,
} from "./recipients";

/** Discover bounded directory candidates, including confirmed names without existing DMs. */
export async function discoverCommandRecipients(
  request: string,
  ctx: CommandContext,
  known: CommandRecipient[],
  channels: Channel[],
  scope: string,
  allowed: (person: UserSearchResult) => boolean,
) {
  const aliases = readRecipientAliases(scope);
  const [pages, remembered] = await Promise.all([
    Promise.all(
      ["", ...recipientSearchTerms(request)].map((term) =>
        searchUsers(term, 50),
      ),
    ),
    getUsersBatch(Object.keys(aliases)),
  ]);
  const openChannels = new Set(
    [
      ctx.active.route.conversation,
      ...Object.values(ctx.active.canvas.routes ?? {}).map(
        (r) => r.conversation,
      ),
      ...ctx.active.canvas.windows.map(
        (id) => ctx.catalog.find((v) => v.id === id)?.target,
      ),
    ].filter(Boolean),
  );
  const familiar = known.map((p) => ({
    ...p,
    confirmedAliases: aliases[p.pubkey],
    active: channels.some(
      (c) =>
        openChannels.has(c.id) &&
        c.channelType === "dm" &&
        c.participantPubkeys.includes(p.pubkey),
    ),
  }));
  return rankCommandRecipients(
    request,
    [...ctx.people, ...familiar],
    [
      ...Object.entries(remembered.profiles).map(([pubkey, p]) => ({
        ...p,
        pubkey,
        isAgent: p.isAgent ?? false,
        aliases: [p.name ?? ""],
        confirmedAliases: aliases[pubkey],
      })),
      ...pages
        .flatMap((p) => p.users)
        .map((p) => ({ ...p, confirmedAliases: aliases[p.pubkey] })),
    ],
    allowed,
  );
}
