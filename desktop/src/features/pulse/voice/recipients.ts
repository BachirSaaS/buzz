import type { UserSearchResult } from "@/shared/api/types";
import { truncateNpub } from "@/shared/lib/pubkey";
import { searchWindowCatalog } from "../lib/windowCatalog";
export type CommandRecipient = UserSearchResult & {
  known?: boolean;
  aliases?: string[];
  confirmedAliases?: string[];
  lastMessageAt?: number;
  active?: boolean;
};
export const personName = (p: CommandRecipient) =>
  p.displayName || p.nip05Handle || truncateNpub(p.pubkey);
const normalizeName = (value: string) =>
  value
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
export function recipientDescription(p: CommandRecipient) {
  return `${personName(p)} @${p.nip05Handle ?? ""}; ${p.confirmedAliases?.length ? `confirmed names: ${p.confirmedAliases.join(", ")}; ` : ""}${p.aliases?.join(", ") ?? ""}; ${p.active ? "open conversation; " : ""}${p.known ? `existing DM; latest ${p.lastMessageAt ? new Date(p.lastMessageAt).toISOString().slice(0, 10) : "unknown"}` : "new contact"}`;
}
/** Only extract simple, explicit recipient lists; complex phrasing stays with Jev. */
export function requestedRecipientNames(
  request: string,
  count: number,
): string[] {
  const list = request.match(/\b(?:with|to)\s+(.+?)[.!?]*$/i)?.[1];
  const names =
    list
      ?.split(/\s+and\s+|\s*&\s*|,\s*/i)
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  return names.length === count && names.every((n) => n.length <= 64)
    ? names
    : [];
}
/** A confirmed alias or unique familiar first-name prefix can resolve a short name. */
export function familiarRecipient(name: string, people: CommandRecipient[]) {
  const key = normalizeName(name);
  if (!key || name.startsWith("@")) return undefined;
  const aliases = people.filter((p) =>
    p.confirmedAliases?.some((a) => normalizeName(a) === key),
  );
  if (aliases.length === 1) return aliases[0];
  if (/\s/.test(name)) return undefined;
  const familiar = people.filter(
    (p) =>
      p.known &&
      [p.displayName, p.nip05Handle, ...(p.aliases ?? [])].some(
        (n) => n && normalizeName(n).startsWith(key),
      ),
  );
  if (familiar.length === 1) return familiar[0];
  const active = familiar.filter((p) => p.active);
  return active.length === 1 ? active[0] : undefined;
}
export function readRecipientAliases(scope: string): Record<string, string[]> {
  const raw = localStorage.getItem(`buzz-voice-names.v1:${scope}`);
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value)
        .slice(-256)
        .filter(
          ([key, names]) => /^[a-f0-9]{64}$/.test(key) && Array.isArray(names),
        )
        .map(([key, names]) => [
          key,
          (names as unknown[])
            .filter(
              (n): n is string =>
                typeof n === "string" && n.length > 0 && n.length <= 64,
            )
            .slice(-8),
        ]),
    );
  } catch {
    return {};
  } // A malformed optional nickname cache cannot prevent a new command.
}
export function rememberRecipientAlias(
  scope: string,
  name: string,
  pubkey: string,
) {
  if (!name.trim() || name.length > 64 || !/^[a-f0-9]{64}$/.test(pubkey))
    return;
  const aliases = readRecipientAliases(scope);
  for (const key of Object.keys(aliases))
    aliases[key] = aliases[key].filter(
      (n) => normalizeName(n) !== normalizeName(name),
    );
  aliases[pubkey] = [...(aliases[pubkey] ?? []), name.trim()].slice(-8);
  localStorage.setItem(
    `buzz-voice-names.v1:${scope}`,
    JSON.stringify(Object.fromEntries(Object.entries(aliases).slice(-256))),
  );
}
const ignoredWords = new Set(
  "start create open new a an at the dm direct message chat conversation group with to and please me i want can you could would for hey jev buzz".split(
    " ",
  ),
);
/** Bound directory discovery while retaining natural person names from dictation. */
export function recipientSearchTerms(request: string) {
  return [...new Set(request.toLowerCase().match(/[\p{L}\p{N}_.@-]+/gu) ?? [])]
    .filter((word) => !ignoredWords.has(word) && word.length > 1)
    .slice(0, 12);
}
/** Known DM peers remain discoverable even when relay search requires complete tokens. */
export function rankCommandRecipients(
  request: string,
  known: CommandRecipient[],
  discovered: UserSearchResult[],
  allowed: (person: UserSearchResult) => boolean,
): CommandRecipient[] {
  const people = new Map<string, CommandRecipient>();
  const candidates: CommandRecipient[] = [...known, ...discovered];
  for (const person of candidates) {
    if (!allowed(person)) continue;
    const previous = people.get(person.pubkey);
    people.set(person.pubkey, {
      ...person,
      displayName: person.displayName || previous?.displayName || null,
      nip05Handle: person.nip05Handle || previous?.nip05Handle || null,
      known: person.known || previous?.known,
      aliases: person.aliases ?? previous?.aliases,
      confirmedAliases: person.confirmedAliases ?? previous?.confirmedAliases,
      lastMessageAt: person.lastMessageAt ?? previous?.lastMessageAt,
      active: person.active ?? previous?.active,
    });
  }
  return searchWindowCatalog(
    [...people.values()]
      .sort(
        (a, b) =>
          Number(Boolean(b.active)) - Number(Boolean(a.active)) ||
          (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0),
      )
      .map((p) => ({
        id: p.pubkey,
        kind: "dm",
        title: p.displayName || p.nip05Handle || p.pubkey,
        aliases: [
          p.nip05Handle ?? "",
          ...(p.aliases ?? []),
          ...(p.confirmedAliases ?? []),
        ],
        description: "Recipient",
      })),
    recipientSearchTerms(request).join(" "),
  ).flatMap((entry) => {
    const person = people.get(entry.id);
    return person ? [person] : [];
  });
}
