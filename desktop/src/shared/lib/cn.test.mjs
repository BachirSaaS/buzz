import assert from "node:assert/strict";
import test from "node:test";
import { cn } from "./cn.ts";
import { BLOCKUI_FONT_SIZES } from "../blockui/typography.ts";
for (const size of BLOCKUI_FONT_SIZES) {
  test(`Block UI ${size} survives color merging and replaces a previous size`, () => {
    assert.equal(
      cn("text-sm", `text-blockui-${size}`, "text-muted-foreground"),
      `text-blockui-${size} text-muted-foreground`,
    );
    assert.equal(
      cn(
        `text-blockui-${size}`,
        "text-sm",
        "text-blockui-text-standard",
        "text-foreground",
      ),
      "text-sm text-foreground",
    );
  });
}

for (const radius of ["xs", "sm", "12", "md", "lg", "32", "xl", "pill"]) {
  test(`Block UI ${radius} radius replaces the source component radius`, () => {
    assert.equal(
      cn("rounded-xl p-4", `rounded-blockui-${radius} p-6`),
      `rounded-blockui-${radius} p-6`,
    );
    assert.equal(
      cn(`rounded-blockui-${radius}`, "rounded-none"),
      "rounded-none",
    );
  });
}
