# Pulse prototype briefing

The 48px title bar now contains 24px navigation buttons for Home, Messages,
Projects, Agents, and Apps. Hovering a button for 80ms opens a popover without taking focus; its first row opens the
main view, and destination rows jump straight to a conversation or project.
Messages shows up to six recent joined conversations with real unread markers,
plus New message and Search. Projects shows recently opened projects (scoped to
identity and relay), falling back to the available project list on first use.
Agents shows live availability and working status, with shortcuts to direct chats. Apps contains enabled Workflows. The account avatar opens Settings. Layout controls and the avatar occupy a dedicated right-hand title-bar slot, so project controls cannot shift them when switching apps.
Adjacent menus open immediately, with a 350ms warm window after hover dismissal. A transparent bridge and 180ms leave grace keep the pointer path forgiving. Clicking a hover preview pins it; a second click, outside click, or Escape dismisses it. Touch uses tap. Keyboard entry is instant, with Enter/Space, arrow navigation, and Escape focus return. High-frequency menus have no entry or exit animation; pointer presses have subtle reduced-motion-aware feedback.

The content below the title bar has 24px padding on every side. Home is always a centered, full-height scroll view with a 720px maximum width, independent of saved window geometry or layout. It has no move/resize handles and never changes stacking order. Added windows sit above it and can be arranged around it; tiled presets use the side margins. Other standalone tiled main views have a 960px maximum. Without companions the main view is centered. With companions the canvas fills the padded area and panels share the space left over. Drag the gap between columns to resize adjacent windows, or focus it and use arrow keys (Shift for larger steps), Home/End for the bounds, and Enter or double-click to reset. Split layouts use those widths as defaults; dragging a divider can grow the main window beyond them while keeping neighboring panels usable. Standalone tiled main windows retain their caps. Movable Freeform windows can stretch to the canvas edge, with or without companions. Escape cancels a drag. Sizes are stored once when a drag completes, per layout and community/identity. Narrow canvases stack with no resize handles. The old content-width setting is superseded by this layout. The canvas supports up to three companion windows beside the main app. Use
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

Home groups the past 48 hours of subscribed channel activity into focus areas. Each card has a short recap, one or two original message bubbles or rich artifacts, and a route to its source threads. GitHub and image previews reuse the Messages renderer; Home requests rich presentation without changing the saved Messages preference. Cards use 24px insets and corners with a three-level type hierarchy.

Home cards sit directly on the app canvas, separated by 4px, without an outer panel or visible page/card headers. The Home heading and time range remain available to screen readers. Loading, summary retry, and incomplete-activity messages remain visible when applicable.

The scroll frame fills the workspace with 24px corners. Card footers contain prototype-only Snooze and Reply icon buttons plus the working conversation link; actions wrap on narrow windows. Summary/overview provenance is an accessible card label rather than visible footer text.

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
