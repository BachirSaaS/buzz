# Block UI source

Copied from squareup/blockui-web; SOURCE.json pins the revision and original
file digests. The source is pre-release. Do not publish this local prototype.

theme.css defines Block UI roles. aliases.css connects semantic slots and
component shapes. foundation.css supplies the verified Button states and
Tailwind bindings. fonts.css uses locally bundled Inter variable fonts for interface text (copied
from mobile/assets/fonts, with the SIL Open Font License) and Cash Sans Mono
for code. font-sources.json pins every asset digest. This is a requested Buzz
typeface override; the Block UI type scale and weights remain unchanged.
Color values are preserved.

Adaptations: comments shortened; imports point into Buzz; dimensions use rem;
type values follow Buzz's text preference. application.css owns explicitly
chosen Buzz compositions for navigation, media, and other roles that Block UI
does not specify. Application adapters preserve existing control APIs and
interaction semantics where the source has a different primitive interface.


Source-copy components live in components/. Shared UI adapters retain Buzz's
asChild composition, keyboard/modifier handling, native form semantics, and
existing overlay focus behavior. Busy states use the source Spinner with one
accessible status owner. Button loading/disabled guards have rendered tests.

fonts.css is imported directly from main.tsx so Vite resolves and hashes the
local font URLs correctly. typography.ts lists the 19 upstream text utilities;
shared/lib/cn.ts registers them with tailwind-merge. check:blockui verifies that
the CSS, typography list, and class merger remain synchronized and checks the
font digests. Run it after importing another upstream source revision.

## Icon sizing

Use Lucide's standard 2-unit stroke for interface actions. Compact buttons,
menus, header actions and toolbars use 16px (`size-4`) glyphs; utility/meta
indicators can use 12px (`size-3`), and larger actions use 20px (`size-5`).
Illustrations, identity artwork and empty-state symbols retain their larger
intentional sizes. Prefer one `size-*` utility over separate height and width.

Button's desktop defaults are 16/16/20px for small/medium/large, matching the
upstream icon size tokens. Shared control selectors supply a size only when a
glyph has no explicit `size-*`, `h-*`, or `w-*` utility. This prevents control
styles from inflating small glyphs or shrinking larger contextual symbols.
A button's click target is independent of its glyph size: header actions remain
32px tall. Browser coverage checks channel and DM headers in both color modes,
including keyboard activation of the members control.
