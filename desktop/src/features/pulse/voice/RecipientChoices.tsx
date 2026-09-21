import { Action } from "@/shared/ui/action";
import { personName } from "./recipients";
import type { useInterfaceCommands } from "./useInterfaceCommands";

/** Recipient clarification shared by workspace creation and Ask Buzz. */
export function RecipientChoices({
  commands,
}: {
  commands: ReturnType<typeof useInterfaceCommands>;
}) {
  if (!commands.clarifying) return null;
  return (
    <fieldset aria-label="Recipient choices" className="space-y-1">
      {commands.suggestions.map((person, index) => (
        <Action
          key={person.pubkey}
          type="button"
          disabled={commands.busy}
          onClick={() => void commands.choose(person.pubkey)}
          className="flex w-full items-center gap-2 rounded-lg bg-muted px-3 py-2 text-left text-sm disabled:opacity-50"
        >
          <span aria-hidden>{index + 1}.</span>
          <span>
            {personName(person)}
            {person.nip05Handle && person.nip05Handle !== personName(person)
              ? ` · @${person.nip05Handle}`
              : ""}
          </span>
          <span className="ml-auto text-xs text-muted-foreground">
            {person.active
              ? "Open chat"
              : person.known
                ? "Previous DM"
                : "New contact"}
          </span>
        </Action>
      ))}
      <p className="text-xs text-muted-foreground">
        Your choice completes this request and remembers this spoken name for
        your account in this community.
      </p>
    </fieldset>
  );
}
