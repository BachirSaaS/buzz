import assert from "node:assert/strict";
import { test } from "node:test";
import {
  workspaceIconSubject,
  workspaceIconQuestions,
  decodeWorkspaceIcons,
  parseWorkspaceIcons,
} from "./workspaceIcons.ts";

const music = {
  id: "widget:music",
  kind: "widget",
  title: "Music",
  aliases: [],
  description: "Music player",
};
const subject = {
  id: "studio",
  name: "Studio",
  route: {},
  canvas: { main: false, layout: "columns", windows: [music.id] },
};
test("icon context follows content and title but ignores geometry and window order", () => {
  const original = workspaceIconSubject(subject, [music]);
  assert.match(original.fingerprint, /Music/);
  assert.deepEqual(
    workspaceIconSubject(
      {
        ...subject,
        canvas: {
          ...subject.canvas,
          layout: "freeform",
          freeform: {
            frames: { [music.id]: { x: 42, y: 10, width: 500, height: 400 } },
          },
        },
      },
      [music],
    ),
    original,
  );
  assert.notEqual(
    workspaceIconSubject({ ...subject, name: "Night shift" }, [music])
      .fingerprint,
    original.fingerprint,
  );
  const conversation = {
    id: "dm:alice",
    target: "alice",
    title: "Alice — Design",
    kind: "dm",
  };
  const withMain = {
    ...subject,
    route: { feed: "conversation", conversation: "alice" },
    canvas: { layout: "focus", windows: [] },
  };
  assert.match(
    workspaceIconSubject(withMain, [conversation]).fingerprint,
    /Alice — Design/,
  );
  assert.notEqual(
    workspaceIconSubject(
      { ...subject, canvas: { ...subject.canvas, windows: [] } },
      [music],
    ).fingerprint,
    original.fingerprint,
  );
});
test("Jev icon choices are allowlisted but do not inherit action confidence requirements", () => {
  const subjects = [workspaceIconSubject(subject, [music])];
  assert.match(
    workspaceIconQuestions(subjects).workspace_icon_0.instructions,
    /Music/,
  );
  const answer = {
    workspace_icon_0: { choice: "music", probability: 0.3, margin: 0.02 },
  };
  const cache = decodeWorkspaceIcons(subjects, answer);
  assert.equal(cache.studio.icon, "music");
  assert.deepEqual(parseWorkspaceIcons(JSON.stringify(cache)), cache);
  assert.throws(() =>
    decodeWorkspaceIcons(subjects, {
      workspace_icon_0: {
        choice: "<svg onload=evil>",
        probability: 1,
        margin: 1,
      },
    }),
  );
  assert.throws(() => decodeWorkspaceIcons(subjects, {}));
  assert.deepEqual(
    parseWorkspaceIcons(
      JSON.stringify({ studio: { icon: "unknown", fingerprint: "x" } }),
    ),
    {},
  );
});
