# Block UI desktop prototype

This branch is local only. Do not push it or publish its assets.

## Scope

Replace the desktop application's visual system across every route, dialog,
panel, and shared control. Preserve Buzz's identity, relay operations, navigation,
conversation density, font-size preference, keyboard zoom, and accessibility.
The Flutter mobile application and the separate repository browser are outside
this desktop prototype.

## Source

- [Documentation](https://argos-ci.squareupstaging.com/storybook/blockui-web-main-block/sites/blockuiweb/docs/)
- [Storybook](https://argos-ci.squareupstaging.com/storybook/blockui-web-main-block/)
- [Component source](https://github.com/squareup/blockui-web)

Block UI is a source-copy evaluation, not an installable package. Its latest
source includes a verified Button with Figma state colors, loading, pill geometry,
and small/medium/large sizes. Other source components supply the shared visual primitives; documented
Buzz adapters retain existing interaction contracts where needed. The copied source revision and adaptations are recorded with the
vendored files.

## Migration work

- [x] Vendor color, typography, shape, and button state definitions.
- [x] Replace generated syntax-theme UI palettes with Block UI light/dark/system.
- [x] Replace gradient chrome, powder textures, and decorative surface treatments.
- [x] Replace shared controls and overlay presentation from Block UI source.
- [x] Migrate feature-level colors, typography, shapes, inputs, and actions.
- [x] Exercise onboarding, messaging, thread, search, settings, profiles, agents,
      workflows, projects, pulse, reminders, and huddle surfaces.
- [x] Check type safety, formatting, unit tests, browser workflows, and screenshots.

## Explicit product adaptations

Block UI has no reviewed sidebar role family or categorical chart palette.
Buzz navigation uses its existing Block UI surface, text, border, and selection
roles. Data visualizations use semantic status roles and neutral series with
labels; these are prototype mappings, not new Block UI canon.

The source typography and shape values are converted to rem without changing
their default pixel values. Text also follows Buzz's existing font-size dial.
Conversation text retains the 13/14/15px preference contract.

Appearance preferences for this private prototype are local. They must not
publish a replacement theme into the user's relay-backed community settings.

## Implementation map

| Area | Replacement |
| --- | --- |
| Foundations | Source light/dark role colors, Inter and Cash Sans Mono, typography, discrete radii, borders, focus and interaction states |
| Shared components | Source buttons, inputs, textarea, checkbox, switch, avatars, badges, cards, alerts, separators, skeletons, spinners, tables, keyboard labels, message and attachment composition |
| Interaction adapters | Block UI presentation over existing dialog, menu, popover, tooltip, tabs and toggle behavior; native radio/range semantics; compound actions use Base UI |
| Application shell | Flat Block UI navigation and content surfaces, semantic selected states, local light/dark/system settings |
| Product surfaces | Messaging, composer, threads, search, inbox, pulse, projects, agents, workflows, settings, onboarding and huddles consume the shared system |
| Retired styling | Generated UI theme palettes, accent customization, gradient chrome, powder textures, glass controls and decorative loading artwork |

Source files live in `src/shared/blockui`. `SOURCE.json` records upstream revision
`0b14736ffaf07a916b67a0f707045b13c9b1c5af` and original file digests.
`application.css` records product-specific mappings rather than presenting them
as official Block UI roles. Identity fallbacks use the neutral Avatar treatment;
agent identity can use the prominent/inverse pair. The persistent headphones
hint uses the opaque card surface so text behind the popup cannot compete with
its instructions. The source typography names are registered with the
class merger so text color utilities cannot silently discard text sizing.

## Validation

- TypeScript check and the desktop E2E production build pass.
- Desktop formatting/lint, pixel-text and pubkey guards pass (existing lint
  warnings remain). The new Block UI audit checks 729 production TSX/CSS files,
  all 19 typography utilities, and four font assets against their SHA-256 hashes.
- Full desktop unit suite: **6,523 passed**. The subsequent loading-state cleanup
  also passed 85 targeted transcript, typography and tooltip tests.
- Selected browser regression suites exercise real rendered controls, messaging,
  workflows, backup, tooltip dismissal, keyboard focus, theme persistence and
  text preferences. The final appearance/startup/visual suite passed 18 tests. The expanded visual and
  huddle suite passed all 35 tests; the final avatar contrast/gallery rerun
  passed its nine tests.
- 48 distinct screenshots cover light and dark application routes, all 14 settings
  sections, onboarding and active huddles. They are local artifacts under
  `test-results/blockui`; `index.html` is the visual review gallery.

Browser tests use Buzz's mock Tauri bridge. Native Tauri windows, real relay/media
connections, Flutter mobile and the separate web repository browser were not
validated by this desktop prototype. This is not a claim that every repository
E2E spec or native integration suite has run.

## Local preview and checks

From the repository root, activate Hermit before running these commands:

```sh
. ./bin/activate-hermit
pnpm --dir desktop dev --host 127.0.0.1
# Open http://127.0.0.1:5173/?e2e=mock
pnpm --dir desktop check
pnpm --dir desktop typecheck
pnpm --dir desktop test
pnpm --dir desktop test:e2e:smoke -- blockui.spec.ts blockui-behavior.spec.ts
```

The branch is `am-blockUI-proto`, has no upstream, and has not been pushed.
Keep both this source-copy prototype and its screenshots local.

## Icon consistency pass

The membership header action now uses the same 16px Lucide glyph and 32px
control height as its neighboring actions. Shared Button, menu, tab, toggle,
attachment, alert and empty-state defaults respect explicitly sized icons.
Lucide glyph dimensions use the single `size-*` form throughout the desktop;
compact toolbar/menu/header glyphs use the 16px step and heavy one-off Lucide
stroke overrides have been removed. Utility indicators and illustration sizes
remain intentional. The source README records the sizing contract.

## Native staging app with an existing Buzz profile

Run `bash scripts/run-blockui-staging.sh` from the repository root. It builds
**Buzz Block UI Staging**, then reads the existing `buzz-desktop` identity from
macOS Keychain and starts the app against `wss://buzz.block.builderlab.xyz`.
Use `bash scripts/run-blockui-staging.sh --no-build` to relaunch the last build.

The launcher supplies the signing key only through the app process environment;
it does not print it or write it to the checkout or a configuration file. The
app uses the supported shared-identity startup path to skip onboarding and
load the real profile. Its named-demo identity gives it separate app data,
agent configuration, deep links, and credentials. Use the launcher for future
starts so it receives the identity and production relay again.

## Pulse conversation layout

Ported `am-pulse-proto` at `8b5a0904730c52391c1477e2e0e72f617ca3abf8` into the local Block UI branch. Pulse now uses the prototype's persistent combined DM/channel list, directional message bubbles, inline thread navigation, attached reactions, typing feedback, and embedded projects/agents/workflows navigation. Search and side panels stay in the Pulse workspace.

The presentation uses Block UI neutral surfaces, prominent/inverse outgoing bubbles, Inter, the conversation text-size ramp, named corner tokens, shared actions and 16px toolbar icons. Old theme/accent palettes and glass settings are not imported. Bubble links remain underlined and use the correct foreground in both directions.

Open `/pulse?feed=conversation` for All messages. Native and staging launches default to Home at `/pulse`. Home supports native summaries through the locally signed-in Codex CLI; see the activity recap section below.

Validation: 6,538 desktop unit tests passed. All 20 imported Pulse browser workflows passed across the initial run and focused visual-fix rerun; two additional checks verify light/dark token binding and text/radius scaling with root zoom. The shared messaging/navigation/Block UI regression run also passed 117 browser tests (one skipped). Desktop typecheck, native staging build, lint, text sizing and Block UI audits passed.

### Native glass and app dock

Pulse uses a compact vertical dock with 40px app tiles and 20px glyphs, accessible labels/tooltips, and a prominent selected state. The outer radius is the 12px tile radius plus 8px padding, derived from the same Block UI tokens. Refresh is hidden; live refresh and reconnect recovery remain active. The in-flow history toolbar is restored: the dock and main pane align beneath it, with bottom padding matching its 40px height. Profile side panels share those insets.

Settings uses the same `PulseWorkspaceFrame` as Messages: the dock stays visible beside a 220px settings section list and independently scrolling detail pane. Settings URLs and history remain intact; section switches replace the current history entry so Back exits Settings in one step. Dock navigation returns to the selected conversation or opens another embedded app.

The main macOS window installs the existing `under-window-background` vibrancy material, then reveals it through transparent shell layers and a 72% Block UI app-canvas tint. The conversation pane and dock retain solid readable surfaces. The initial inline boot color is removed only after native vibrancy succeeds. Increased contrast and reduced transparency use the opaque fallback; failures retain the opaque surface and offer Retry. The browser preview uses its normal solid background because desktop blur is native to Tauri.

Eight focused browser checks passed across the initial and fix verification runs, including dock keyboard navigation, window insets, embedded workspace navigation, conversation drafts/live updates, side panels, light/dark zoom, and native-glass CSS handoff with contrast fallback. Native bundle build and desktop lint/type/token checks passed.

Settings frame follow-up: 14 focused browser checks passed across three runs, covering history, section switching, keyboard dock navigation, radius geometry, pane alignment, light/dark settings surfaces, zoom, search, and native-glass fallback. Desktop lint/type/token checks passed.


## Rich content and agent activity widgets

`ContentWidget` composes the source Block UI Card. Message previews use an 8px
base grid, 24px outer radius and content inset, 16px grouping gaps, and 8px
control gaps. Inter has three named size steps (12/14/16) and three weights
(400/500/600) per component. All sizes follow root zoom. Code uses Cash Sans Mono.
The class merger recognizes the named Block UI corner tokens, so source defaults
cannot silently override composition radii.

GitHub PR/issue/repository, Linear, Google documents, and general web previews
share provider/type, title, supporting description, optional media, and source
regions. GitHub repository and issue/PR numbers come from the actual URL; no
review status, checks, counts, or other unavailable metadata are invented.
Compact/Rich preferences, description expansion, media proxy URLs, image
fallbacks/lightbox, preview removal, and the original message link are preserved.
Files, signed agent snapshots, code blocks, and tables use the same card geometry.
Widgets use their own readable surfaces beside conversation bubbles.

Agent activity separates the action from its reported outcome and duration.
Plans show actual completed/total counts and progress; errors and permissions
stay visible. Inputs, output, diffs, reasoning, and raw events remain expandable.
Nested disclosures share the parent's inset. A visible Working label accompanies
live turns, respecting reduced motion and the transcript animation preference.
The activity header stays opaque and readable over scrolling content.

Validation includes production-rendered light/dark previews and ACP activity,
24px geometry, typography limits, keyboard disclosures, real plan progress,
media proxy behavior, compact/rich switching, and existing Pulse layouts.

Desktop typecheck, lint, font sizing, and Block UI audits passed. The full unit
run passed 6,537 checks; its nine terminal failures were resolved by completing
the native-window mock, and all nine passed on rerun (6,546 total). Focused
browser verification passed in light/dark themes, including activity live/error/
completed states, keyboard expansion, plan progress, preview media/fallbacks,
attachment downloads and error recovery, code copy/paste, scoped agent Stop,
Pulse media/panels/dock, and application routes. Old geometry assertions now
check the 24px widget contract; route tests use the persistent Pulse dock.

## Agents workspace and catalog

Agents now has a persistent `Your agents` / `Browse` section pane within the
Pulse frame. Browse uses the same identity-card grid as the personal library,
with search over relay-confirmed shared agents and teams. Section selection is
stored in the route for back/forward and reload. Catalog cards open an explicit
review before adding; exact instructions, publisher attribution, duplicate
prevention, and untrusted-avatar handling remain intact.

Add agent now contains Create and Import instead of catalog navigation. Its
24px corner/inset geometry, 8px spacing grid, Inter hierarchy, compact avatar
column, and scrolling body match the workspace. The footer stays in flow below
the body so controls never cover fields. Draft discard confirmation, file import,
and existing runtime/default configuration behavior are preserved. Feedback lives
at the workspace level so switching sections cannot hide add errors or success.

Validation: 40 focused unit checks and 20 browser workflows passed, including
light/dark rendering, keyboard navigation, history/reload, successful creation,
search, catalog add/duplicate protection, import, draft preservation, literal
instruction review, publisher attribution, and a narrow modal. Desktop type,
lint, font-size, and Block UI audits passed (existing lint warnings remain).

### Shared sidebar capsules

Agents, Settings, Messages, and Projects use `WorkspaceSidebarButton`, extracted
from the Agents navigation. Rows share 48px height, capsule corners, 16px insets,
8px gaps, 16px navigation glyphs, and the prominent selected state. Sidebars use
the same muted surface and padding. Settings groups retain separator lines;
conversation rows retain avatars, presence, and accessible unread/working state.
Selected-row indicators use the inverse foreground for contrast.

Validation: 12 existing browser workflows passed across the initial and spacing
assertion rerun, including every Settings surface in light/dark, workspace
navigation, history, conversation drafts, live unread state, and working dots.
Desktop type, lint, font-size, and Block UI checks passed.

### Window, typography, and avatar refinement

Rechecked the current Block UI documentation and Card preview. The outer Pulse
window uses `surface-app` (#f5f5f5 / #000000); the floating workspace and dock use
`surface-card` (#ffffff / #171717) and the same `shadow-sm`. This is a Buzz
composition of the documented roles, not an upstream window/elevation preset.
Native desktop vibrancy remains enabled beneath the neutral canvas tint.

Interface text now loads Inter variable normal/italic locally, reusing the
licensed mobile assets. The existing type ramp, weights, preferences, and zoom
remain unchanged; code retains its monospace face. Font digests are audited.
Channel and group-DM glyphs sit in 28px circles on `surface-standard`, matching
conversation avatars. Avatar images, fallbacks, and outlines inherit the root
shape; a single neutral fill prevents a circular overlay on empty agent avatars.

Validation: light/dark browser checks cover the canvas and card roles, actual
Inter loading and zoom, matching shadows, channel circle sizing, empty avatar
geometry, Settings, dock keyboard/history navigation, and native glass fallback.
Existing avatar network-suppression tests pass.

### Home dock and resilient catch-up

Home owns the former For you view as a separate dock app. Messages retains Search,
All messages, and its conversation list. Home has its own scroll area, keeps the
shared window/dock geometry, and supports route reload, history, keyboard access,
and returning from Settings without losing a conversation draft.

Home groups recent subscribed-channel activity into focus areas with concise summaries and one or two original supporting message bubbles, image attachments, or rich repository previews. Each card routes to its source threads. Rich previews share the Messages renderer without changing the user's saved preview preference. Cards preserve the 24px inset/radius and three-level typography hierarchy.

Packaged native builds use a bounded, ephemeral Codex CLI run with the local sign-in. Shared prompt/schema files keep development and native output consistent. Exact source validation rejects invented evidence and cross-channel grouping. Generation failures retain labeled channel overviews and a retry; relay failures still show an incomplete-activity warning. No relay messages are published by summarization.

The staging launcher reads the existing Buzz signing identity from Keychain without printing or saving it. Rebuilt ad-hoc-signed apps may need fresh macOS authorization for the staging agent-secret store. Blob reads now share a single request and cache denied reads as errors, preventing parallel callers or repeated hydration from opening a stack of prompts. After denying or unlocking Keychain, relaunch to retry; successful credential mutations also refresh the cache. Production credentials and Keychain access controls are unchanged.

## Overlay consistency and local card gallery

Buzz dialog, sheet, menu, and popover content uses the opaque Block UI card role.
The source translucent popover tint remains in the source tokens, but is not
used alone as a reading surface: content behind an overlay must not compete with
its labels. This is a Buzz composition choice, not a change to upstream tokens.
Overlays use 24px corners; menus pair 8px padding with 16px row corners and 40px
minimum rows. Dialog/chooser content uses 24px insets. Workflow header, footer,
canvas nodes, and inspector follow the same neutral surface and spacing rules.

For a live, local preview, open `/link-cards.html` on the desktop Vite dev server
(e.g. `http://127.0.0.1:5173/link-cards.html`). This standalone development entry
renders `LinkPreviewWidget` directly with synthetic metadata for all 14 supported
link kinds. It includes light/dark, message/compact/Home-scale layouts and
text/image/loading/unavailable states. It does not read an account, fetch link
metadata, or ship in the normal single-entry desktop build.

Link cards use `--blockui-card-shadow-standard` (the smallest shadow) with
a one-pixel border and no footer. A stretched native link makes the card surface navigable;
the header menu sits above it with independent focus and pointer handling.
Display changes are local to each card; Appearance still sets the default.
Image zoom remains available through the menu via the existing lightbox controller.
