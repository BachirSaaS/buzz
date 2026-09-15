/** @type {import('tailwindcss').Config} */
export default {
  theme: {
    extend: {
      // Sub-`text-xs` ramp for meta text (timestamps, count badges, tracking
      // labels) and tiny glyphs. These follow the virtual typography rem
      // (`--buzz-type-rem` in styles/globals/typography.css), which is
      // rem-relative: Cmd +/- zooms it with the rest of the layout, and the
      // Font size preference nudges it alone. Do NOT reintroduce arbitrary `text-[…rem]` / `text-[…px]` literals;
      // the px-text guard rejects them. Stock scale picks up from xs.
      fontSize: {
        "2xs": "calc(var(--buzz-type-rem) * 0.6875)", // 11px at 16px type rem
        "3xs": "calc(var(--buzz-type-rem) * 0.5)", // 8px at 16px type rem
        badge: "calc(var(--buzz-type-rem) * 0.625)", // 10px at 16px type rem
        "status-indicator": "0.9375rem", // 15px at the default root size
        // Shared channel, DM, thread, and composer type. Variables keep app-wide
        // font size and keyboard zoom consistent without branching components.
        message: [
          "var(--conversation-message-font-size)",
          { lineHeight: "var(--conversation-message-line-height)" },
        ],
        "message-timestamp": [
          "var(--conversation-timestamp-font-size)",
          { lineHeight: "var(--conversation-timestamp-line-height)" },
        ],
        // 40px at the 16px type rem — onboarding page titles.
        title: [
          "calc(var(--buzz-type-rem) * 2.5)",
          { lineHeight: "1.15", letterSpacing: "-0.02em" },
        ],
        // 36px at the 16px type rem — backup-step private key.
        "nsec-key": [
          "calc(var(--buzz-type-rem) * 2.25)",
          { lineHeight: "1.3" },
        ],
        // 22px at the 16px type rem — compact onboarding-card private key.
        "nsec-key-card": [
          "calc(var(--buzz-type-rem) * 1.375)",
          { lineHeight: "1.3" },
        ],
      },
      lineHeight: {
        // Keep fixed Tailwind line-height utilities in the typography scale so
        // Cmd +/- cannot enlarge glyphs inside an unchanged line box. Single-
        // line surfaces keep their existing truncate/overflow behavior.
        3: "calc(var(--buzz-type-rem) * 0.75)",
        4: "var(--buzz-type-rem)",
        5: "calc(var(--buzz-type-rem) * 1.25)",
        6: "calc(var(--buzz-type-rem) * 1.5)",
        7: "calc(var(--buzz-type-rem) * 1.75)",
        8: "calc(var(--buzz-type-rem) * 2)",
        "message-author": "var(--conversation-author-line-height)",
      },
      boxShadow: {
        "content-edge":
          "-1px -1px 0 0 color-mix(in srgb, var(--sidebar-border) 45%, transparent)",
        // Edge + elevation for a surface anchored to the right of the content
        // area, whose only exposed edge faces left. Tailwind's stock shadows are
        // all y-offset, so they cast almost nothing sideways — `shadow-xl` on a
        // left-facing edge is nearly invisible. Both layers run -x so they wrap
        // the surface's rounded left corners: the hairline draws the boundary
        // (and carries dark mode, where a black shadow reads as nothing), the
        // soft layer carries the lift. A left-only `border` can't do this job —
        // it tapers out at each corner instead of turning it.
        "panel-left":
          "-1px 0 0 0 color-mix(in srgb, var(--border) 80%, transparent), -16px 0 32px -12px rgb(0 0 0 / 0.18)",
      },
      borderRadius: {
        lg: "var(--blockui-radius-12)",
        md: "var(--blockui-radius-sm)",
        sm: "var(--blockui-radius-xs)",
      },
      spacing: {
        4.5: "1.125rem",
        "status-indicator": "0.9375rem", // 15px at the default root size
        "conversation-body": "var(--conversation-body-gap)",
        "conversation-list": "var(--conversation-list-item-gap)",
        "conversation-paragraph": "var(--conversation-paragraph-gap)",
        "conversation-row": "var(--conversation-row-padding-block)",
      },
      fontFamily: {
        sans: ['"Inter Local"', "system-ui", "sans-serif"],
        mono: ['"Cash Sans Mono Local"', "ui-monospace", "monospace"],
      },
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        sidebar: {
          DEFAULT: "var(--sidebar-background)",
          foreground: "var(--sidebar-foreground)",
          primary: "var(--sidebar-primary)",
          "primary-foreground": "var(--sidebar-primary-foreground)",
          active: "var(--sidebar-active)",
          "active-foreground": "var(--sidebar-active-foreground)",
          accent: "var(--sidebar-accent)",
          "accent-foreground": "var(--sidebar-accent-foreground)",
          border: "var(--sidebar-border)",
          ring: "var(--sidebar-ring)",
        },
        status: {
          added: "var(--status-added)",
          deleted: "var(--status-deleted)",
          modified: "var(--status-modified)",
        },
        warning: {
          DEFAULT: "var(--ui-warning)",
          bg: "var(--ui-warning-bg)",
        },
      },
    },
  },
  plugins: [],
};
