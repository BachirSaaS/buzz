# Widget gallery

Fourteen interactive web widgets, each with small, medium, and large compositions,
built with Block UI foundations and Cash Sans.
In Buzz Pulse, choose **+ → Widgets** and add an individual widget, **Buzz widgets**,
or **All widgets**.
They use the existing canvas layout, reorder, close, and community-scoped persistence.
Widget heights follow their content; the collection scrolls within its window.
The new-window chooser renders these same small compositions through `WidgetPreview.tsx`,
using isolated gallery samples for Buzz cards. Previews are inert; each card has one
selection button, and the Music preview does not mount an audio player.

For visual review, a secondary browser-only gallery has Buzz and Everyday collections.
This entry has no Tauri, relay, or account dependency.
Its Small / Medium / Large controls switch density across the collection;
Compare sizes places the three compositions beside each other.

Inside Pulse, each widget follows its available width: small below 320px,
medium from 320px to 431px, and large from 432px. Resizing preserves component
state and existing live adapters. Heights remain content-driven.

| Widget | Small | Medium | Large |
| --- | --- | --- | --- |
| Agent activity | Quiet identity/status, latest tool, usage; selection in options | Two tools, agent context, usage capacity | Three tools and current operation detail |
| Huddle | Large grouped avatars open the group selector and start/join controls | More avatars, same single action | Named roster and same action |
| Mentions | Three avatar launchers | Three single-line previews | Expanded previews and reply counts when available |
| Conversations | Three single/group avatar launchers | Three compact rows with grouped avatars | Longer previews |
| Active channels | Recent participants as avatar launchers | Three channel previews | Longer previews |
| Location | Full-bleed map and place | More map area and zoom controls | Expanded map area |
| Weather | Conditions, forecast on demand | Five daily highs | Daily highs and lows |
| News | Lead story | Three headlines | Images and lead story summary |
| Music | Compact art, play/pause, scrubber | Larger art and ten-second skip controls | Album artwork leads |
| Flight | Airport codes, dates and local times | City names | Explicit departure/arrival labels |
| Inbox | Latest sender and subject | Three subjects and times | Message previews |
| Mood board | Two photos | Four-photo grid | One lead image with three supporting photos |
| Up next | Event and one time line | Grouped attendees | Named attendees and purpose |
| Activity | Daily value, goal and ring | Day selection | Day totals for comparison |

Conversation identity uses single/grouped avatars instead of DM/group badges.
Workspace member counts and duplicate event/huddle labels are omitted.
Small communication cards have one primary heading above their avatars, without text previews. Each avatar button
has a destination label and hover title; loading/error/empty states remain explicit.

## Drop into another Buzz view

Use `CanvasWidgets.tsx` for existing Buzz data and actions. It imports the styles,
adds the scoped wrapper, and sizes each widget. It does not own canvas window chrome.

```tsx
import { CanvasWidgets } from "@/features/widgets/CanvasWidgets";

<CanvasWidgets
  target="buzz"
  size="small"
  feed={feed}
  currentPubkey={currentPubkey}
  onOpen={openConversation}
/>
```

`feed` is the existing `useUnifiedPulseFeed` result (`CanvasFeed`); `onOpen` has
the signature `(view: CanvasView, thread?: string) => void` and belongs to the host.
Render within Buzz's existing query, identity, and huddle providers. Set `target`
to `agent-activity`, `huddle`, `mentions`, `conversations`, or `channels` for one
widget; `buzz` renders all five. Omit `size` for automatic width-based sizing,
or choose `small`, `medium`, or `large` explicitly.

For custom data, compose `AgentActivityWidget`, `HuddleWidget`, or
`CommunicationWidget` from `BuzzWidgets.tsx` inside `WidgetSizing` and a
`widget-scope` element; import `widgets.css` and the app's shared Block UI theme.
`CompactAgentActivity.tsx` owns the quiet small agent presentation.
`BuzzCanvasWidgets.tsx`, `LiveAgentWidget.tsx`, and `LiveHuddleWidget.tsx` contain
the live adapters. `BuzzWidgetGallery.tsx` is the standalone gallery fixture layer,
not the integration entry point.

From the repository root:

```sh
. ./bin/activate-hermit
bin/pnpm --dir desktop dev:widgets
```

The page is at http://127.0.0.1:1425/widgets.html. `build:widgets` produces a
separate `desktop/dist-widgets` bundle. `test:widgets` exercises that built page.

The five Buzz widgets in Pulse use its authorized conversations, observer feed,
and existing huddle actions. Agent usage is the latest reported context-token
snapshot, not an aggregate or billing total; unavailable usage remains unknown.
Only events in joined channels are shown, and tools/usage belong to the latest
turn of the selected agent and channel. Conversation rows navigate to their
existing thread. Huddles start or join in an existing group/channel and surface
roster/start failures with retry. They do not invite additional people implicitly.

The standalone gallery uses isolated fixtures and local interactions. Everyday
personal data, dates, weather, and news are also fixtures in this first set. The
map is an illustrative San Francisco map, not a navigation provider. Music plays
an original locally generated instrumental sample. Photos load from Unsplash;
URLs and alternative text are in `data.ts`. The gallery does not read account data.
There are no fixture disclaimers in the widget UI; provider boundaries remain
explicit in the implementation, and live Buzz adapters never fall back to fixtures.

## Composition contract

- One `Widget` shell, intrinsic content height, 24px radius and 24px content inset.
- 8px base grid; 8/16/24px gaps. Image-led content can bleed to the edge.
- Cash Sans Regular (400) and Medium (500), with a maximum of three sizes per card.
- Existing Block UI type roles supply the 14/16/24/32/56px steps in rem.
- Plain headings without trailing metadata. Prioritize the answer and its useful
  context; the flight ends at its departure/arrival dates and local time zones.
- Neutral controls and surfaces. Photography provides color; activity's single
  green progress arc carries goal progress. Keyboard focus is always visible.
- No forced action for informational cards. Dialogs expose more detail only when
  useful, and native controls retain keyboard behavior and focus return.

Canvas widget windows have no Anatomy controls. Profile images use Buzz’s shared avatar component, including relay media proxying and initials on load failure.

In the standalone design gallery, Anatomy mode reveals the 8px grid, 24px content boundary, and each card's type
scale. Theme changes are local to this standalone page. All state is ephemeral.

| Widget | Type sizes | Interaction |
| --- | --- | --- |
| Agent activity | 14 / 16 / 24 | Select agent, inspect reported tools/tokens, open full activity |
| Huddle | 14 / 16 / 24 | Select an existing conversation, start/join, return to active huddle |
| Mentions | 14 / 16 / 24 | Open the three most recent mentioning conversations |
| Conversations | 14 / 16 / 24 | Open recent threads |
| Active channels | 14 / 16 / 24 | Open the latest conversation in each active channel |
| Location | 14 / 16 / 32 | Zoom and recenter |
| Weather | 14 / 16 / 56 | °F/°C, select forecast; tap selected day to return to now |
| News | 14 / 16 / 24 | Read three sample article previews |
| Music | 14 / 16 / 24 | Play/pause, ±10 seconds, seek |
| Flight | 14 / 16 / 32 | Read itinerary |
| Inbox | 14 / 16 | Open email and mark read locally |
| Mood board | 14 / 16 / 24 | Enlarge and browse photos |
| Up next | 14 / 16 / 24 | View event and attendees |
| Activity | 14 / 16 / 32 | Inspect daily steps and goal progress |

`agentWidgetModel.test.mjs` checks normalized observer usage, turn isolation, and
error states. `pulse-widgets.spec.ts` exercises canvas persistence, scoped observer
rendering, thread navigation, and the production huddle-start seam through the
mock bridge. Browser gallery tests verify typography, keyboard interactions,
light/dark appearance, and narrow layouts.

## Source and scope

Reference: `squareup/design-blockinterface/blockUI/Design.md`, `Taste.md`, and
`docs/anti-slop.spec.md`. Runtime foundation values reuse Buzz's pinned
`shared/blockui/theme.css`; see its `SOURCE.json` for source revision.

The requested 24px corners override the reference applet benchmark's 32px.
These are exploratory everyday widgets, rather than financial applets claiming
compliance with its fixed Heading/A/B/C sizes. Content-driven heights, full-bleed
media, and transport controls are explicit user-directed compositions. The work
supports Buzz's glanceable surfaces without introducing relay API or persistence.

Individual components accept data props where meaningful. `data.ts` keeps the
demo content separate. Future live adapters should pass verified data, loading
and error states, and freshness without turning sample content into a live fallback.
Keep this local prototype private, per the vendored Block UI source guidance.
