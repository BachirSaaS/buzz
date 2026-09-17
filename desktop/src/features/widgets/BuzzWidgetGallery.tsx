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
  { id: "you", name: "You" },
  { id: "mia", name: "Mia" },
  { id: "leo", name: "Leo" },
  { id: "ava", name: "Ava" },
];
const mentions = [
  {
    id: "mia",
    title: "Mia Chen",
    context: "#design",
    body: "@you The new widgets are ready for a fresh pair of eyes. What do you think?",
    replies: 4,
  },
  {
    id: "leo",
    title: "Leo Park",
    context: "#engineering",
    body: "@you The canvas update is in. Want to give it a spin?",
    replies: 2,
  },
  {
    id: "ava",
    title: "Ava Williams",
    context: "#general",
    body: "@you Adding your notes to the team recap. Anything else to include?",
    replies: 1,
  },
];
const conversations = [
  {
    id: "design",
    title: "Mia & Leo",
    context: "Group conversation",
    body: "Let’s keep the first version small and get it into people’s hands.",
  },
  {
    id: "ava",
    title: "Ava Williams",
    context: "Direct conversation",
    body: "That works for me. See you at 2!",
  },
  {
    id: "team",
    title: "The design crew",
    context: "Group conversation",
    body: "A few new references for tomorrow’s session.",
  },
];
const channels = [
  {
    id: "design",
    title: "#design",
    context: "12 members",
    body: "Mia: A little less chrome, a little more room for the work.",
    initials: "#",
  },
  {
    id: "engineering",
    title: "#engineering",
    context: "24 members",
    body: "Leo: The latest build is ready to try.",
    initials: "#",
  },
  {
    id: "watercooler",
    title: "#watercooler",
    context: "48 members",
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
        title="You, Mia, Leo & Ava · Design crew"
        people={people}
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

/** Isolated compositions for browser design review; Pulse supplies its own live adapters. */
export function BuzzWidgetGallery() {
  const [open, setOpen] = useState<Omit<CommunicationRow, "onOpen"> | null>(
    null,
  );
  const rows = (items: Omit<CommunicationRow, "onOpen">[]) =>
    items.map((item) => ({ ...item, onOpen: () => setOpen(item) }));
  return (
    <>
      <div className="widget-grid">
        <div className="widget-column">
          <AgentActivityWidget
            agent={{
              name: "Studio agent",
              context: "#design · Refining the widget system",
              status: "Using tools",
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
          <CommunicationWidget
            title="Active channels"
            headline="Around your workspace."
            rows={rows(channels)}
            empty="No recent activity."
          />
        </div>
        <div className="widget-column">
          <GalleryHuddle />
          <CommunicationWidget
            title="Conversations"
            headline="Pick up where you left off."
            rows={rows(conversations)}
            empty="No recent conversations."
          />
        </div>
        <div className="widget-column">
          <CommunicationWidget
            title="Mentions"
            headline="You’re in the conversation."
            rows={rows(mentions)}
            empty="You’re all caught up."
          />
        </div>
      </div>
      {open && (
        <DetailDialog title={open.title} onClose={() => setOpen(null)}>
          <p className="small subtle">{open.context}</p>
          <p>{open.body}</p>
        </DetailDialog>
      )}
    </>
  );
}
