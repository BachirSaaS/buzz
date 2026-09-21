# Try the voice workspace prototype

Branch: `am-blockUI-proto-chief` in `block/buzz`.

This prototype adds a floating workspace dock and a persistent command capsule.
Type or speak to open conversations and apps, create workspaces, and arrange
windows. Jev interprets requests; Buzz validates and applies the selected actions.

## Run on macOS

The staging launcher uses your own existing Buzz identity from macOS Keychain
and connects to the Block production community. Sign in to the regular Buzz app
first. The prototype has a separate app name and local settings. You need the
desktop development prerequisites in [CONTRIBUTING.md](../CONTRIBUTING.md),
including Xcode command-line tools. This is a source-build prototype, not a signed
installer; the first build downloads toolchains and compiles the native sidecars.

In a fresh checkout:

```sh
git clone --branch am-blockUI-proto-chief https://github.com/block/buzz.git buzz-voice
cd buzz-voice
. ./bin/activate-hermit
pnpm install --frozen-lockfile
```

Create a root `.env` file if you do not already have one, and add your Jev key:

```dotenv
TYPESAFE_API_KEY=your-key-here
```

Use your own TypeSafe key, or a shared trial key supplied privately by the demo
owner. `.env` is ignored by Git. Keys are read by the native process at runtime;
they are not bundled into the app or exposed as frontend `VITE_*` variables.
Your Buzz signing identity is separate from the Jev key and is never shared with
other testers.

From the repository root, build and launch with `.env` loaded:

```sh
node --env-file=.env --input-type=module -e '
  import { spawnSync } from "node:child_process";
  const result = spawnSync("bash", ["scripts/run-blockui-staging.sh"], {
    stdio: "inherit", env: process.env,
  });
  process.exit(result.status ?? 1);
'
```

For subsequent launches of the same build, add `"--no-build"` after the script
path in the argument array. Quit the staging app before relaunching. Use this
launcher after changing the key; opening the `.app` from Finder does not inherit
the terminal's environment. People using another community should follow the
normal desktop development setup instead of this Block-specific launcher.

## Try it

- Click the keyboard icon to type; **Enter** submits and **Shift+Enter** inserts
  a line. Click the mic icon or press **Cmd+B** to start live listening.
- Click the voice waveform to mute. Speech recognition runs locally; the first
  activation downloads the speech model and macOS requests microphone access.
- Say **“projects on the left”**, then **“make it bigger.”** Enable Projects in
  Settings → Experiments if it is unavailable in your build.
- Open two conversations, then say **“move Kenny and Cynthia right”** and
  **“move them more.”** Substitute people in your own directory. The remembered
  selection is scoped to the current workspace and cleared on workspace changes.
- Try **“create a workspace with music and weather,” “split screen,” “all windows
  25% smaller,”** or **“use focus layout.”** Focus is a vertical reading column;
  newly opened windows go to its top.
- Try **“start a DM with Matt and Jared.”** This opens an unsent draft. Names use
  your own directory and recent activity; unclear recipients prompt for a choice.
- Workspaces have their own layouts and icons. Use the dock to switch between them.

Live listening can act before you stop talking. Jev receives transcript text and
matching app, workspace, and people metadata; microphone audio stays on-device.
Interface commands do not send messages, run agents, or change permissions.
Some widgets contain sample data. Home summaries separately use your locally
signed-in Codex CLI; see the [implementation briefing](../desktop/src/features/pulse/README.md).

## Troubleshooting

- **Missing key / authentication error:** check `TYPESAFE_API_KEY` in `.env`,
  then quit and restart through the command above.
- **Missing Buzz identity:** sign in to the normal Buzz app and allow Keychain
  access when the staging launcher requests it.
- **Microphone unavailable:** allow Buzz Block UI Staging in macOS Privacy &
  Security → Microphone. Typed commands use the same Jev planner.
- **Unclear target:** use the full person, conversation, or workspace name.
  “It” and “them” refer to the last successfully selected window or group.
- **Stale build or missing sidecars:** rerun the launcher without `--no-build`.

This branch is for trying the prototype. It has not been submitted for merge or
published as an official Buzz release.
