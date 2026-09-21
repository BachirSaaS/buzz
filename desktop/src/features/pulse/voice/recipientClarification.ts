import {
  selectDecision,
  question,
  type Decisions,
  type ChoiceQuestion,
} from "./intent";
import {
  familiarRecipient,
  requestedRecipientNames,
  recipientDescription,
  type CommandRecipient,
} from "./recipients";

export type RecipientResolution = {
  names: string[];
  recipients: (string | null)[];
};
/** Keep unresolved slots without partially opening a composer or discarding resolved people. */
export function resolveRecipients(
  request: string,
  people: CommandRecipient[],
  specs: Record<string, ChoiceQuestion>,
  answers: Decisions,
): RecipientResolution {
  const count = Number(selectDecision(answers, "count", specs.count));
  if (!Number.isInteger(count) || count < 0 || count > 8)
    throw new Error("A DM supports up to eight recipients.");
  const names = requestedRecipientNames(request, count);
  const recipients: (string | null)[] = [];
  for (let i = 0; i < count; i++) {
    const id = `target_${i + 1}`;
    const answer = answers[id];
    // Invalid model data is still a transport failure, not an invitation to guess.
    if (
      !answer ||
      !Object.hasOwn(specs[id].criteria, answer.choice) ||
      !Number.isFinite(answer.probability) ||
      answer.probability < 0 ||
      answer.probability > 1 ||
      !Number.isFinite(answer.margin) ||
      answer.margin < 0 ||
      answer.margin > answer.probability
    )
      throw new Error("Jev returned an invalid recipient decision. Try again.");
    const familiar = familiarRecipient(names[i] ?? "", people);
    const candidate =
      familiar ??
      (answer.probability >= 0.5 && answer.margin >= 0.15
        ? people.find((p) => p.pubkey === answer.choice && p.known)
        : undefined);
    recipients.push(
      candidate && !recipients.includes(candidate.pubkey)
        ? candidate.pubkey
        : null,
    );
  }
  return { names, recipients };
}
export function recipientFollowupQuestion(
  people: CommandRecipient[],
  selected: (string | null)[],
  displayed: string[] = [],
) {
  return question(
    "Resolve ONLY the recipient being clarified from this reply. Names, usernames and ordinal positions refer to the displayed candidates. Do not reinterpret the original operation. Choose unavailable when uncertain.",
    {
      ...Object.fromEntries(
        people
          .filter((p) => !selected.includes(p.pubkey))
          .slice(0, 80)
          .map((p) => [
            p.pubkey,
            `${displayed.includes(p.pubkey) ? `Displayed option ${displayed.indexOf(p.pubkey) + 1}: ` : ""}${recipientDescription(p)}`.slice(
              0,
              220,
            ),
          ]),
      ),
      unavailable: "No clear match; ask for a name or username",
    },
  );
}
