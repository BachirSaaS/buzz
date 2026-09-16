# Pulse prototype briefing

Pulse on this branch uses the combined conversation layout from `am-pulse-proto` with Block UI tokens and components. Home, Messages, Projects, Agents, and Workflows live in the dock. Home owns the catch-up; Search, All messages, and individual conversations live inside Messages. Open `/pulse?feed=conversation` to begin with All messages.

Home groups the past 48 hours of subscribed channel activity into focus areas. Each card has a short recap, one or two original message bubbles or rich artifacts, and a route to its source threads. GitHub and image previews reuse the Messages renderer; Home requests rich presentation without changing the saved Messages preference. Cards use 24px insets and corners with a three-level type hierarchy.

Home cards sit directly on the app canvas, separated by 16px, without an outer panel or visible page/card headers. The Home heading and time range remain available to screen readers. Loading, summary retry, and incomplete-activity messages remain visible when applicable.

People from the source threads appear above each recap, with evidence authors first. The composition uses Block UI's AvatarGroup and overflow count: up to three 64px avatars with 16px overlap, followed by a +N count. These dimensions are Buzz's composition on the 8px grid, not additional upstream size tokens. People retain circular avatars and agents retain their squircle identity. Each avatar opens the existing profile panel with pointer or keyboard input. Contextual message objects render at 50% scale within Home only; image viewers, profile panels, and the conversation action retain their normal size.

In the native prototype, `summarize_pulse_activity` uses the locally signed-in Codex CLI. Only bounded recent conversation context is submitted, including substantive private conversations. No credential is embedded in the frontend. The subprocess does not inherit Buzz signing keys. Browser development can opt in with `BUZZ_PULSE_SUMMARY_PROVIDER=codex` in `desktop/.env.local` and optionally `BUZZ_PULSE_CODEX_BIN`. Browser tests mock the endpoint.

Both adapters share the prompt and strict response schema. Runs are ephemeral and read-only with shell, apps, plugins, web search, image tools, and multi-agent tools disabled. Native runs have one concurrency slot, a 90-second deadline, bounded output, and automatic temporary-file cleanup. Browser requests have a 95-second deadline.

Input includes at most 30 recent conversations, three per channel, eight messages per conversation, and 650 characters per message. Unchanged activity never triggers a model run merely because time passes. A one-minute throttle limits updates, and changed input waits for the current request to finish. The last valid summary remains visible if a later refresh fails. Requests use short, request-local references instead of long relay IDs; responses map back only through that request’s reference table. Generated cards must reference supplied conversation and message IDs, and cannot mix channels. Images render from original messages; the model does not inspect their pixels. Clicking a card opens Messages Search filtered to its source threads.

While summaries load or fail, Home shows grouped channel overviews with useful original evidence. Overviews are explicitly labeled rather than presented as generated summaries. A separate retry remains available; relay failures retain an incomplete-activity warning. Agent requests inferred from messages are not authoritative runtime status.

Messages uses a single combined conversation layout. Search appears
as a circular-icon row above All messages in the persistent sidebar. All messages
opens the mixed DM and channel feed beside a 220px list of joined DMs and channels,
sorted by the newest relay timestamp or loaded message. Selection is independent
of list order, so incoming activity does not switch the open conversation. The
selected conversation lives in the URL and survives reloads; conversation detail
and draft storage stay within the 960px container. Older variation links open
this same combined layout.

Conversation detail uses message bubbles: incoming messages align left on the Block UI standard surface,
and messages authored by the signed-in viewer align right on the Block UI prominent fill with its inverse foreground. This is scoped
to Pulse through the message presentation context. Aggregate feed posts and
expanded replies share the bubble layout; Home highlights combine summaries with this same message and attachment presentation. Replies, reactions, attachments, editing,
and pending-send status use the existing message components and handlers.
Threads drill into the conversation area at every width; Back returns to the
conversation while the Pulse sidebar stays visible. Terminal sessions dock on the
right of the conversation. Opening a terminal, channel settings, profile, or agent
side panel expands the container to the available window width; closing the last
side panel restores the 960px limit. The terminal retains its sessions, keyboard
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
