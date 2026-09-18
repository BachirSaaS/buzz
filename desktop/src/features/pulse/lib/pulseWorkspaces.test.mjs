import { test } from "node:test";
import assert from "node:assert/strict";
import { homeCanvas, parseWorkspaces } from "./pulseWorkspaces.ts";
import { initialLayout } from "./panelLayout.ts";
import { parentWindowIds } from "./parentWindows.ts";

test("Home restores its summary without losing connected companions or other workspaces", () => {
  const canvas = {
    layout: "columns",
    windows: ["widget:weather", "app:messages"],
    interiors: {
      main: initialLayout(
        ["main", "widget:weather", "app:messages"],
        "columns",
      ),
    },
    routes: {
      "app:messages": { feed: "conversation", conversation: "general" },
    },
  };
  const parsed = parseWorkspaces(
    JSON.stringify({
      active: "home",
      items: [
        { id: "home", name: "Home", route: { feed: "projects" }, canvas },
        {
          id: "custom",
          name: "Custom",
          route: {},
          canvas: { main: false, layout: "focus", windows: [] },
        },
      ],
    }),
  );
  const home = parsed.items[0];
  assert.deepEqual(home.route, { feed: "home" });
  assert.equal(home.canvas.main, undefined);
  assert.deepEqual(home.canvas.windows, canvas.windows);
  assert.deepEqual(home.canvas.routes, canvas.routes);
  assert.deepEqual(parentWindowIds(home.canvas), ["main", "widget:weather"]);
  assert.equal(home.canvas.interiors.main, undefined);
  assert.deepEqual(homeCanvas(home.canvas), home.canvas);
  assert.deepEqual(parseWorkspaces(JSON.stringify(parsed)), parsed);
  assert.equal(parsed.items[1].canvas.main, false);
});
test("restoring Home after an empty-workspace prototype preserves all four saved windows", () => {
  const data = {
    active: "home",
    items: [
      {
        id: "home",
        name: "Home",
        route: {},
        canvas: {
          main: false,
          layout: "grid",
          windows: [
            "widget:weather",
            "widget:music",
            "app:messages",
            "app:projects",
          ],
        },
      },
    ],
  };
  const parsed = parseWorkspaces(JSON.stringify(data));
  assert.equal(parsed.items[0].canvas.main, undefined);
  assert.equal(parsed.items[0].canvas.windows.length, 4);
  assert.deepEqual(parseWorkspaces(JSON.stringify(parsed)), parsed);
});
