import { Headphones, Mic, MicOff } from "lucide-react";
import { useState } from "react";
import {
  AgentActivityWidget,
  CommunicationWidget,
  HuddleWidget,
  WidgetPeople,
  type CommunicationRow,
} from "./BuzzWidgets";
import { Control, DetailDialog } from "./Widget";

const people = [
  {
    id: "you",
    name: "You",
    avatar:
      "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=160&h=160&fit=crop&crop=faces&auto=format",
  },
  {
    id: "mia",
    name: "Mia",
    avatar:
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=160&h=160&fit=crop&crop=faces&auto=format",
  },
  {
    id: "leo",
    name: "Leo",
    avatar:
      "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=160&h=160&fit=crop&crop=faces&auto=format",
  },
  {
    id: "ava",
    name: "Ava",
    avatar:
      "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=160&h=160&fit=crop&crop=faces&auto=format",
  },
];
const mentions = [
  {
    id: "mia",
    title: "Mia Chen",
    avatar: people[1].avatar,
    context: "#design",
    body: "@you The new widgets are ready for a fresh pair of eyes. What do you think?",
    replies: 4,
  },
  {
    id: "leo",
    title: "Leo Park",
    avatar: people[2].avatar,
    context: "#engineering",
    body: "@you The canvas update is in. Want to give it a spin?",
    replies: 2,
  },
  {
    id: "ava",
    title: "Ava Williams",
    avatar: people[3].avatar,
    context: "#general",
    body: "@you Adding your notes to the team recap. Anything else to include?",
    replies: 1,
  },
];
const conversations = [
  {
    id: "design",
    title: "Mia & Leo",
    people: [people[1], people[2]],
    body: "Let’s keep the first version small and get it into people’s hands.",
  },
  {
    id: "ava",
    title: "Ava Williams",
    avatar: people[3].avatar,
    body: "That works for me. See you at 2!",
  },
  {
    id: "team",
    title: "The design crew",
    people: [people[1], people[2]],
    body: "A few new references for tomorrow’s session.",
  },
];
const channels = [
  {
    id: "design",
    title: "#design",
    compactPeople: [people[1], people[2]],
    body: "Mia: A little less chrome, a little more room for the work.",
    initials: "#",
  },
  {
    id: "engineering",
    title: "#engineering",
    compactPeople: [people[2]],
    body: "Leo: The latest build is ready to try.",
    initials: "#",
  },
  {
    id: "watercooler",
    title: "#watercooler",
    compactPeople: [people[3]],
    body: "Ava: What’s on your repeat playlist this week?",
    initials: "#",
  },
];

function GalleryHuddle() {
  const [open, setOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  return (
    <>
      <HuddleWidget
        title="Design crew"
        people={people}
        active={open}
        action={
          <Control
            className="communication-action"
            onClick={() => setOpen(true)}
          >
            <Headphones aria-hidden="true" />
            Start huddle
          </Control>
        }
      />
      {open && (
        <DetailDialog title="Design huddle" onClose={() => setOpen(false)}>
          <WidgetPeople people={people} />
          <div className="huddle-room-controls">
            <Control
              aria-pressed={muted}
              onClick={() => setMuted((value) => !value)}
            >
              {muted ? (
                <MicOff aria-hidden="true" />
              ) : (
                <Mic aria-hidden="true" />
              )}
              {muted ? "Unmute" : "Mute"}
            </Control>
            <Control onClick={() => setOpen(false)}>Leave huddle</Control>
          </div>
        </DetailDialog>
      )}
    </>
  );
}

/** The gallery supplies isolated content; Pulse uses its live adapters. */
export function GalleryBuzzWidget({ id }: { id: string }) {
  const [open, setOpen] = useState<Omit<CommunicationRow, "onOpen"> | null>(
    null,
  );
  const rows = (items: Omit<CommunicationRow, "onOpen">[]) =>
    items.map((item) => ({ ...item, onOpen: () => setOpen(item) }));
  if (id === "huddle") return <GalleryHuddle />;
  if (id === "agent-activity")
    return (
      <AgentActivityWidget
        agent={{
          name: "Studio agent",
          context: "#design · Widget system",
          status: "Checking the details",
          active: true,
          tokens: 12480,
          capacity: 128000,
          toolCount: 3,
          tools: [
            {
              id: "read",
              title: "Read design guidelines",
              state: "completed",
              detail:
                "Read the shared spacing, typography, and component guidance.",
            },
            {
              id: "edit",
              title: "Update widget styles",
              state: "completed",
              detail:
                "Applied the shared 8px grid, 24px inset, and Cash Sans type scale.",
            },
            {
              id: "test",
              title: "Run interaction checks",
              state: "executing",
              detail:
                "Checking keyboard navigation, responsive layouts, and widget controls.",
            },
          ],
        }}
      />
    );
  return (
    <>
      <CommunicationWidget
        title={
          id === "mentions"
            ? "Mentions"
            : id === "conversations"
              ? "Conversations"
              : "Active channels"
        }
        rows={rows(
          id === "mentions"
            ? mentions
            : id === "conversations"
              ? conversations
              : channels,
        )}
        empty="You’re all caught up."
      />
      {open && (
        <DetailDialog title={open.title} onClose={() => setOpen(null)}>
          {open.context && <p className="small subtle">{open.context}</p>}
          <p>{open.body}</p>
        </DetailDialog>
      )}
    </>
  );
}
