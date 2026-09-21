import { useUsersBatchQuery } from "@/features/profile/hooks";
import { NewMessageScreen } from "@/features/messages/ui/NewMessageScreen";
import { Button } from "@/shared/ui/button";

/** Resolve local recipient references before mounting the ordinary, unsent composer. */
export function VoiceMessageDraft({ recipients }: { recipients: string }) {
  const pubkeys = [
    ...new Set(
      recipients.split(",").filter((id) => /^[a-f0-9]{64}$/i.test(id)),
    ),
  ].slice(0, 8);
  const query = useUsersBatchQuery(pubkeys, { enabled: pubkeys.length > 0 });
  if (pubkeys.length && query.isError)
    return (
      <div role="alert" className="p-5 text-sm">
        Couldn't load recipients.{" "}
        <Button onClick={() => void query.refetch()}>Try again</Button>
      </div>
    );
  if (pubkeys.length && !query.isSuccess)
    return (
      <p role="status" className="p-5 text-sm">
        Loading recipients…
      </p>
    );
  return (
    <NewMessageScreen
      key={recipients}
      initialRecipients={pubkeys.map((pubkey) => {
        const p = query.data?.profiles[pubkey];
        return {
          pubkey,
          displayName: p?.displayName || p?.name || null,
          nip05Handle: p?.nip05Handle ?? null,
          avatarUrl: p?.avatarUrl ?? null,
          isAgent: p?.isAgent ?? false,
          ownerPubkey: p?.ownerPubkey ?? null,
        };
      })}
    />
  );
}
