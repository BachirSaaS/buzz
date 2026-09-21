# Pulse prototype briefing

For installation, Jev configuration, and example commands, see the
[try-it guide](../../../../docs/try-voice-workspaces.md).

Navigation currently uses the 48px top bar: labeled workspace tabs on the left,
pinned conversations and Settings on the right. Left/Right and Home/End move
between workspace tabs; Enter/Space selects. New-workspace, pinned-chat and rename
popovers open below their triggers. The persistent bottom command capsule is
unchanged. `lib/navigationLayout.ts` selects this presentation with
`PULSE_NAVIGATION_LAYOUT = "top"`; switch it to `"dock"` to restore the retained
vertically centered floating dock. Both presentations share workspace state,
Jev-selected icons, pinned chats and menus. The dock's layout and styling remain
intact and overlay the canvas without reserving width.

The content below the title bar has symmetric 16px side padding. Home and Focus center against the full app width; the dock does not affect their layout. Home has a 720px maximum reading width and no move/resize handles. In Focus, its summary follows the windows in one centered scrolling column. In Grid, Columns and Freeform, it remains anchored independently of window geometry; companions use the side margins or float above it. Other standalone tiled main views have a 960px maximum. Without companions the main view is centered. With companions the canvas fills the padded area and panels share the space left over. Drag the gap between columns to resize adjacent windows, or focus it and use arrow keys (Shift for larger steps), Home/End for the bounds, and Enter or double-click to reset. Split layouts use those widths as defaults; dragging a divider can grow the main window beyond them while keeping neighboring panels usable. Standalone tiled main windows retain their caps. Movable Freeform windows can stretch to the canvas edge, with or without companions. Escape cancels a drag. Sizes are stored once when a drag completes, per layout and community/identity. Narrow canvases stack with no resize handles. The old content-width setting is superseded by this layout. The canvas has no window-count cap; every window and its geometry persist with its workspace. Use
the **+** button beside Apps to search joined channels, DMs by participant name,
projects (when enabled), or Agent activity. Focus, Grid, Columns, and Freeform controls appear in the top bar when panels are open or Freeform is active and
arrange the windows; arrow controls reorder companions and Close removes them. Narrow canvases stack vertically. Closing the
last companion restores the centered main workspace. There is no canvas footer caption.

Channel and DM companions embed the same full conversation view as the main pane, including message history, composer, and in-place threads. Threads, profiles, and forum posts have panel-local navigation state; opening or closing them leaves the main pane and other companions unchanged. The header has no promote-to-main shortcut. Project summaries and recent agent conversations still use the existing feed. Layouts store only view IDs and the selected preset, atomically in local
storage per relay and identity. They survive navigation and reloads. Unavailable
views retain a close/retry affordance. Placement uses presets and reorder controls;
Freeform restores the curved bottom-right resize grip on every movable window. Dragging a corner out of a tiled layout lifts the current arrangement into Freeform. Drag the unframed grip outside a window’s top-left corner to move it, click or focus a window to bring it forward, and resize its corner in both dimensions. Move grips show no visible text or container and match the resize corner’s white 50% resting opacity, 80% pointer hover opacity, and reduced-motion-aware spring feedback. Both grips are available in tiled and Freeform layouts; dragging lifts tiled windows into Freeform. Home remains fixed. New windows enter at the front of the stack. Arrow keys work on move/resize handles (Shift for larger steps); Escape cancels a gesture. Windows stay inside the padded canvas. Switching to a tiled layout restores that layout; returning to Freeform restores saved positions and dimensions without remounting conversations. Closing a window clears its placement and stacking metadata.

**+ → Widgets** adds Location, Weather, News, Music, Flight, Inbox, Mood board,
Up next, or Activity, or the complete **All widgets** collection. These are
interactive design previews with clearly labeled sample data. Widget surfaces
use Cash Sans, 24px corners/insets, and content-driven heights. Music plays a
local instrumental; weather, inbox, photos, events, and activity have local
interactive previews. The collection scrolls inside a single companion window.
See `../widgets/README.md` for the composition contract and optional gallery.

Pulse on this branch uses the combined conversation layout from `am-pulse-proto` with Block UI tokens and components. Projects and Workflows appear only when their Settings → Experiments toggles are enabled. Changes apply immediately, including in Settings. Home owns the catch-up; Search, All messages, and individual conversations live inside Messages. Native app and staging launches open `/pulse` (Home), independent of the legacy Pulse experiment toggle. Open `/pulse?feed=conversation` to begin with All messages.

The shell still uses the historical `/pulse` route. Conversation detail embeds the shared `ChannelRouteScreen` and its real timeline, composer, and thread handlers; the older `/channels` shell still exists. Relay identity is shared by the staging launcher, while agent defaults and Buzz-agent OAuth remain app-local. A public npub alone does not transfer provider configuration or credentials. Codex uses the existing CLI sign-in plus Buzz's ACP adapter; Databricks needs a configured host and authentication in staging.

Home groups the past 48 hours of subscribed channel activity into focus areas. Each card has a short recap, one or two original message bubbles or rich artifacts, and a route to its source threads. GitHub and image previews reuse the Messages renderer; Home requests rich presentation without changing the saved Messages preference. Cards use 24px insets, window-matched corners, and a three-level type hierarchy.

Home cards sit in a transparent scroll view with rounded clipping corners and 4px gaps. Cards share the windows’ neutral surface, corner radius, and subtle shadow, with no outer border or window toolbar. The Home heading and time range remain available to screen readers. Loading, summary retry, and incomplete-activity messages remain visible when applicable.

The scroll frame fills the centered Home area and clips at the same corner radius as windows. Card footers contain prototype-only Snooze and Reply icon buttons plus the working conversation link; actions wrap on narrow windows. Summary/overview provenance is an accessible card label rather than visible footer text.

People from the source threads appear above each recap, with evidence authors first. The composition uses Block UI's AvatarGroup and overflow count: up to three 64px avatars with 16px overlap, followed by a +N count. These dimensions are Buzz's composition on the 8px grid, not additional upstream size tokens. People retain circular avatars and agents retain their squircle identity. Each avatar opens the existing profile panel with pointer or keyboard input. Contextual message objects render at 50% scale within Home only, clipped to a 240px-high evidence area; image viewers, profile panels, and the conversation action retain their normal size.

In the native prototype, `summarize_pulse_activity` uses the locally signed-in Codex CLI. Only bounded recent conversation context is submitted, including substantive private conversations. No credential is embedded in the frontend. The subprocess does not inherit Buzz signing keys. Browser development can opt in with `BUZZ_PULSE_SUMMARY_PROVIDER=codex` in `desktop/.env.local` and optionally `BUZZ_PULSE_CODEX_BIN`. Browser tests mock the endpoint.

Both adapters share the prompt and strict response schema. Runs are ephemeral and read-only with shell, apps, plugins, web search, image tools, and multi-agent tools disabled. Native runs have one concurrency slot, a 90-second deadline, bounded output, and automatic temporary-file cleanup. Browser requests have a 95-second deadline.

Both adapters explicitly use `gpt-5.6-terra` with low reasoning. The viewer's authenticated public key identifies their messages as `isViewer` with author `You`; profile names supply contextual aliases without using display-name matches as identity proof. Summaries address the viewer as “you/your,” and fallback channel overviews do the same. Original quoted messages remain unchanged.

Input includes at most 30 recent conversations, three per channel, eight messages per conversation, and 650 characters per message. Unchanged activity never triggers a model run merely because time passes. A one-minute throttle limits updates, and changed input waits for the current request to finish. The last valid summary remains visible if a later refresh fails. Requests use short, request-local references instead of long relay IDs; responses map back only through that request’s reference table. Generated cards must reference supplied conversation and message IDs, and cannot mix channels. Images render from original messages; the model does not inspect their pixels. Clicking a card opens Messages Search filtered to its source threads.

While summaries load or fail, Home shows grouped channel overviews with useful original evidence. Overviews are explicitly labeled rather than presented as generated summaries. A separate retry remains available; relay failures retain an incomplete-activity warning. Agent requests inferred from messages are not authoritative runtime status.

Messages uses a single combined conversation layout. The Messages heading has an ellipsis menu for Recents or Classic, remembered per identity and community. Recents uses activity order; Classic reuses the existing starred channels, custom sections (including their icons and order), Channels, enabled Forums, and Direct messages, with each section's saved sorting. Switching presentation preserves the selected conversation and saved organization. Search appears
as a circular-icon row above a New message menu in the persistent sidebar. The
menu starts a direct message inside the conversation pane or opens the channel
browser, where channels can be joined or created without leaving Messages. All messages
opens the mixed DM and channel feed beside a 220px list of joined DMs and channels,
sorted by the newest relay timestamp or loaded message. Selection is independent
of list order, so incoming activity does not switch the open conversation. The
selected conversation lives in the URL and survives reloads; conversation detail
and draft storage stay in the full workspace. Older variation links open
this same combined layout.

Conversation detail uses message bubbles: incoming messages align left on the Block UI standard surface,
and messages authored by the signed-in viewer align right on the Block UI prominent fill with its inverse foreground. This is scoped
to Pulse through the message presentation context. Aggregate feed posts and
expanded replies share the bubble layout; Home highlights combine summaries with this same message and attachment presentation. Replies, reactions, attachments, editing,
and pending-send status use the existing message components and handlers.
Threads drill into the conversation area at every width; Back returns to the
conversation while the Pulse sidebar stays visible. Terminal sessions dock on the
right of the conversation. Opening a terminal, channel settings, profile, or agent
side panel shares the available window width; closing the last
side panel returns that space to the conversation. The terminal retains its sessions, keyboard
shortcut, maximize, and close controls. Narrow windows show it over the content.

The surrounding canvas uses the Block UI app background. Message rows
have no hover fill. Reactions sit across the bubble’s upper-right edge; hover
actions share that corner (just above existing reactions so both remain usable),
with their position clamped to keep controls reachable on short messages.

Sidebar dots use the shell's unread channel and thread projections, backed by
the existing read markers. Recent activity, self-authored posts, and already-read
messages do not independently create dots. Reading a conversation advances its
channel marker; unread thread replies remain until their thread is read.

Pulse reuses the live channel/cache updates to refresh the aggregate feed in
one-second batches, with a follow-up pass if another update arrives during a
fetch. Returning to the app refreshes it too; reconnect recovery and the existing
30-second focused poll cover missed events and public notes. New conversations
appear automatically at the top; while scrolled down, a new-conversations button
preserves the reading position. The window's refresh button refreshes active
channel, thread, channel-list, and feed queries together.


### Workspaces

Jev selects icons for existing and new workspaces from a bounded Lucide vocabulary using the workspace name and its window titles/kinds. Each workspace gets one persisted choice after a short initial debounce. Adding or removing windows, renaming, moving, resizing, reordering, switching, and reloading never reselect an existing icon. Automatic icon metadata is cached separately per community/identity. An explicit request such as “change this workspace icon to a message icon” saves an override in the workspace snapshot, supports undo, and takes precedence over the automatic choice. Duplicates inherit their source icon. Removed workspace metadata is pruned; late responses cannot replace a saved choice, and first-time results are checked against current content. Cosmetic requests have their own native concurrency lane and cannot occupy the voice-command lane. Errors retain the previous glyph and expose **Retry workspace icons** in the workspace context menu. Only window metadata is submitted, not conversation bodies.

The dock contains named workspaces. Home, Messages, Projects, Agents, and
Apps are starter workspaces; their names remain stable when the main window
changes content. Each owns its last main destination, companion windows,
connected splits, arrangement, and freeform geometry. The dock plus opens a workspace prompt; **Custom** creates
an empty workspace with no implicit Home window, while **Add window** adds to the current one. Double-click
an icon or press F2 to rename it; its context menu also supports rename and close.
Every canvas window’s plain title opens the same view switcher, including widgets,
conversations, connected panes, and empty splits. Choose an app or drill into its
recent destinations; companion conversations open directly without a Messages sidebar.
Swapping preserves the window’s position, size, connections, and tab group, and
persists within its workspace. In a tab group, click an inactive tab to select it,
then click its active title to swap its content. Dragging the title still moves the
tab instead of opening the menu; keyboard selection and Escape restore focus.
Home always keeps its centered 720px summary. Its cards float directly on the canvas
without a window header, background, or accumulator section. Older connected companions
are detached without losing their contents. Links from Home open the corresponding app workspace.
Add window and arrangement choices live in one ellipsis menu at the bottom right across workspaces,
with a reserved strip below the canvas so they never cover a composer or resize corner.

Dock DM pins open 380px-wide, at most 520px-tall dropdown conversations using
the existing timeline and composer. Up to four pins are saved per relay and identity,
independently of canvas windows. Closing a dropdown preserves its composer draft;
Escape and outside clicks dismiss it, and the header offers unpin and close.
The dock’s bottom settings icon opens the existing Settings workspace.

Workspace snapshots are stored atomically per relay and identity in
`buzz-workspaces.v1`. Migration preserves the old shared canvas in Home only,
and leaves the legacy record intact. Browser history includes the workspace ID.


Add window uses a two-pane catalog: All windows, Messages, Projects, Agents,
Apps, and Widgets in the left sidebar; full app windows, individual conversations
and projects, and relevant small widget previews in the detail pane. The same
chooser fills connected splits. New workspaces contain explicit views, and closing their last window returns to the empty canvas. Existing
workspace layouts keep their original main window.

Full app windows reuse the Messages, Projects, Agents, and Apps surfaces. Their
selected conversations, project details, and nested navigation are persisted
with the owning canvas, without changing another window or the workspace URL.
Closing a window removes its navigation and geometry from the same snapshot.


The New workspace prompt and the command capsule share one `InterfaceCommandsProvider`,
Jev transport, command planner, recipient resolver, executor, cancellation fence,
and undo history. The workspace prompt fixes the intent to `create_workspace`;
the command capsule classifies it. Both submit through `resolve_interface_intent` using
`jev-latest` and the native-only `TYPESAFE_API_KEY`. There is no separate workspace
model runner or provider fallback. Custom / Start empty still creates locally.

The metadata catalog includes app/widget IDs, member channels, existing DMs with
profile names and username aliases, and available projects. Up to 80 locally
ranked candidates go to Jev; no message history or signing credentials are sent.
Minor typos, joined words and username prefixes survive local shortlisting. Names
and search strings come from verbatim request spans. Only selected, validated
choices can reach the canvas controller; speculative unused slots cannot veto a
request. Calls share a bounded native transport (15 seconds, 256 KB response cap,
no redirects, one request at a time), and failures remain visible for retry.

Workspace descriptions can combine existing windows with one unsent group DM
draft. For example, “message Matt and Jared, and check the weather” resolves the
same people as the command capsule. An uncertain recipient pauses the entire workspace
creation for a choice; already resolved people, windows and placements remain in
the pending plan. Nothing is persisted or sent until the local plan is complete.
All windows, recipient routes and geometry commit in one workspace snapshot.
Closing the prompt, switching workspaces or choosing Custom retires pending work.

Export `TYPESAFE_API_KEY` in the shell launching the desktop app and restart after
changing it; never expose it as a `VITE_*` variable. Widgets are existing app
components, not generated code. Weather retains its existing prototype data.

## Voice and typed interface commands

The bottom-center command capsule stays visible and starts muted. **Cmd+B**
(Ctrl+B, with Cmd/Ctrl+Shift+Space as an alias) activates voice when muted and
leaves an already active session listening. Clicking the voice capsule toggles
mute; muted waveforms use 20% opacity. The keyboard button morphs it into a typed
command field and releases the microphone; the mic button restores live listening.
Typed drafts survive mode switches. Enter submits, Shift+Enter adds a line, and
Escape returns to muted voice mode and cancels pending work. Escape passes through
to other controls when the capsule is already muted. No separate Ask Buzz button
occupies the canvas toolbar. Only errors appear above the capsule. Recipient choices
expand inside it; ordinary command feedback is announced without a visible toast,
and the send arrow becomes a spinner while a typed command runs.
Explicit workspace navigation, community switching, hiding/unmounting the app,
microphone loss and a 30-minute session limit release the microphone.
Voice-created/switched workspaces keep listening.

An AudioWorklet sends mono 16 kHz PCM in 100 ms blocks. Bounded speech windows yield
partials roughly every 700 ms while talking and finalize after 500 ms of quiet
(or 12 seconds of continuous speech). A dedicated native worker keeps the existing
Parakeet model warm and uses a fresh inference stream for each partial. Audio is
never uploaded or retained. Its integrity-checked download starts if missing.

`voice/liveIntent.ts` asks Jev two atomic questions: whether there is a complete
current request, and which verbatim speech clause contains it. Introductory chatter
and explicit multi-command boundaries are separated before routing. Partial speech
needs the same selected clause on consecutive observations; final speech can act
immediately. Consumed prefixes, serialized actions and revision/cancellation fences
prevent replay. Queues and transcript history are bounded; failures stop listening
with a visible retry message. Jev receives rolling transcript text and bounded
candidate metadata through native IPC using `TYPESAFE_API_KEY`; HTTP connections
and model weights are reused. Typed requests retain the ordinary command path.

The bar combines local destination discovery with Jev commands. `voice/commandCatalog.ts`
builds bounded suggestions from available apps, projects, channels, DMs, workspaces,
settings and creation forms. Typing makes no model request; arrows/Enter or a click
select a concrete validated plan. Submitted natural text and voice requests use Jev
first, with available views and workspace names, icons and contents as context.
If Jev is unavailable, exact known destinations still have a local fallback.
Feature-gated destinations stay out of the catalog.

The extensible operation registry is `voice/intent.ts`. Classification chooses one operation;
`voice/plan.ts` then builds only its relevant typed parameter questions. Jev chooses
from existing IDs and verbatim transcript spans, never generated executable code.
`voice/execute.ts` commits through the existing workspace controller in one snapshot.
Both spoken and typed input use this same path. Current operations:

- Open channels, DMs, projects, Agents, Apps and widgets from the authorized catalog.
- Start a new DM draft with up to eight recipients (including eligible agents).
  The ordinary composer receives recipient references; no conversation/message is
  published until the user submits its first message.
- Create a workspace; switch by name or next/previous, rename or close workspaces.
- Explicitly change a workspace icon, duplicate a workspace, move it to the top/bottom
  of the dock or before/after another workspace, clear its windows, or close all other
  workspaces. Each operation commits one snapshot and supports undo. Clearing Home
  preserves its anchored summary; duplicated Home workspaces contain only its companions.
- Arrange focus, equal columns/split screen, stacked rows, grid or freeform.
  Assign named windows to halves, thirds, two-thirds, quarters or full canvas;
  edges/corners/center preserve size. Resize bigger/smaller/wider/taller or use
  small (35% × 40%), medium (60% × 65%), large (85% × 85%) or maximize presets; focus or close a window. Connected content
  moves with its parent. Home's permanent summary remains anchored.
- Open Projects, repositories, issues, pull requests, project activity, agent browsing,
  and workflow creation views directly, with the correct section selected.
- Search authorized message history, people, agents, channels and local project
  metadata in a Search window. It reuses Cmd+K's search hooks and operators such as
  `in:general` and `from:alice`; results open their conversation/thread or an unsent
  recipient draft. Loading, partial failure/retry and unresolved filters remain visible.
- Browse/join channels through the directory, open channel/agent creation forms,
  or open a specific Settings page. Forms still own validation and submission.
- Undo the last local command if the workspace snapshot hasn't changed since.

Examples: “start a DM with Matt and Jared”, “open buzz design and music”,
“create a workspace with weather and projects side by side”, “move music left”,
“make this window bigger”, “switch to Home”, “rename this workspace Studio”,
“change this workspace icon to a message icon”, “duplicate this workspace”,
“move Design above Studio in the dock”, “close all other workspaces”,
“show me a list of my projects”, “show my reviews”, “browse agents”,
“search Buzz for in:general launch”, “open appearance settings”, “create a channel”.

Each dispatched request is one atomic operation. Live speech can sequence distinct
requests; a single typed request still names one operation. Sending/editing messages,
agent execution, and permission changes are not supported by this registry. DM matching includes profile names, usernames, confirmed spoken aliases,
open DM participants, and the latest conversation timestamp (including channel
recency updates from live messages). Familiar first-name prefixes outrank directory
strangers; multiple plausible familiar people use Jev's recency context or ask.
An uncertain or new recipient pauses the command with a chooser instead of an error.
Voice/typed replies and candidate buttons resume the original request, preserving
already resolved people. Explicit choices remember the requested name by public key
in account/community-scoped local storage, bounded to 256 people and eight names
per person. No message content is sent to Jev for this ranking.
Other ambiguous/unavailable targets leave the transcript editable. Cancel,
unmount, identity/community switch, and intervening workspace edits fence late
results. Directory discovery is bounded to twelve search terms plus one initial
page, with at most 80 candidates; use a fuller name when discovery misses someone.

Tests: `voice/commandCatalog.test.mjs` binds exact destination resolution, ambiguity
and feature gates; `voice/commands.test.mjs` binds parameter decoding and canvas execution;
`voice/live-search-fixtures.mjs` generates live Jev regressions for app-list requests,
subviews, settings and creation entry points;
`tests/e2e/interface-commands.spec.ts` covers the real composer, persistence,
geometry, undo, cancellation, microphone release and hotkey path. Native tests cover
choice validation, bounded audio and actual local speech inference. For opt-in live
Jev regression, generate fixtures with `voice/live-fixtures.mjs`, then run the ignored
`commands::interface_intent::tests::live_interface_intents` test with
`BUZZ_INTERFACE_FIXTURES_PATH` pointing to that JSON and the TypeSafe key exported.

Live regression: `voice/liveIntent.test.mjs` covers partial stability, chatter,
revisions, cancellation and bounded speech windows. `voice/live-stream-fixtures.mjs`
generates production Jev prompts for opt-in live tests. The microphone E2E runs the
real AudioWorklet/PCM path with only native transcription and Jev transport mocked,
and checks that actions happen before stopping and survive voice workspace creation.

## Invisible canvas areas

`voice/canvasAreas.ts` is the shared area vocabulary and geometry implementation.
Coordinates are fractions of the visible Buzz canvas, not the physical desktop.
No overlays or drop-zone UI are required. Named regions move and size the target;
edge and corner commands only position it. Coordinated placements such as
“music left half and weather right half” are one atomic arrangement. Equal split
screen and grid presets tile parent windows in their current order. Existing
minimum window sizes and canvas bounds keep controls reachable. All geometry
remains editable with ordinary drag/resize and persists on reload.

Examples: “put music in the left half”, “weather in the bottom third”, “make this
a small window”, “split screen top and bottom”, “put all windows in a grid”.
The workspace prompt accepts the same placements in its initial description.

`voice/live-layout-fixtures.mjs` generates production question fixtures for the
optional native `commands::interface_intent::tests::live_interface_intents` test
(set `BUZZ_INTERFACE_FIXTURES_PATH` and the existing `TYPESAFE_API_KEY`).

The voice waveform uses one row of 2px rounded strokes with 3px gaps and softly faded ends. A 40px animated avatar sits to the left of both modes, using a bundled looping GIF (a static poster for reduced motion). Voice mode is 128×40px plus its adjacent 40px input-mode toggle; typing expands the capsule to fit the request. Both sit 24px above the window edge and share the windows’ background, border and shadow tokens with the header and floating controls. Layout transforms keep the 220ms morph interruptible without stretching text; reduced motion removes spatial movement.

Window management accepts individual names, named groups, **both windows**, or **all windows** for movement and resizing. “All windows 25% smaller” reduces each movable parent’s width and height by 25%, preserving origins and relative stacking, and commits one undoable snapshot. Explicit percentages (including spoken numbers), narrower/shorter, half/double, and “resize to 75%” are supported. Window minimum sizes still apply. Connected panes transform once as a parent; Home’s summary stays anchored. Group movement preserves spacing; a named area that cannot fit the group at usable sizes leaves the layout unchanged.


Focus layout is a centered, 720px-wide vertical reading column with one outer
scrollbar. New windows opened by the picker, typed commands or live voice are
inserted at the top and revealed immediately. Existing windows retain their order;
a multi-window request preserves mention order. Home's summary follows the windows
in the same scroll flow. Conversations retain their internal message scrolling,
and switching layouts preserves their mounted content and connected panes.

Window additions no longer have a workspace-count cap. Jev handles up to eight targets per request, with parameter questions batched under the native transport limit. Focus clips its entire reading viewport with the window corner radius. Layout edits are scoped to their workspace owner; stale callbacks cannot overwrite another workspace after navigation.


Commands can open and position content in the same transaction: “projects on the
left” opens one Projects window and places it on the left. Plural app names do
not mean multiple windows. If only the redundant count answer is uncertain, a
fully confident, contiguous target list can confirm that same count; ambiguous
or contradictory targets still stop the command.

Comma/newline lists whose items each uniquely match an available catalog name or
alias derive their window slots locally, ignoring capitalization and punctuation
such as channel-name hyphens. Jev resolves those constrained slots and the rest of
the workspace plan without a redundant window-count question. An ambiguous,
unknown, or instruction-bearing item uses the ordinary language planner; no item
is silently dropped.

The command session remembers one successful window/group reference and its
movement direction. “Move Kenny and Cynthia to the right”, then “move them more”
continues moving exactly that pair. “Make it bigger” can refer to the window just
opened even if another window retains keyboard focus. Bare directional moves
nudge by 8% of the canvas, clamped to its bounds; explicitly named edges, corners,
halves and thirds remain absolute placements. Explicit names/directions override
context. References are transient and scoped to the active workspace/community,
and are cleared on undo, workspace changes or removal of any selected window.
Failed or cancelled requests never become the remembered command.
