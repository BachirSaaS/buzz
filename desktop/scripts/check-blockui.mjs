import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
const root = new URL("../", import.meta.url);
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const file = path.join(directory, entry.name);
        return entry.isDirectory() ? files(file) : file;
      }),
    )
  ).flat();
}
const problems = [];
const typography = await readFile(
  new URL("src/shared/blockui/typography.ts", root),
  "utf8",
);
const bindings = await readFile(
  new URL("src/shared/blockui/application.css", root),
  "utf8",
);
const names = [...typography.matchAll(/"([a-z-]+)"/g)]
  .map((match) => match[1])
  .sort();
const sizes = [...bindings.matchAll(/--text-blockui-([a-z]+(?:-[a-z]+)*):/g)]
  .map((match) => match[1])
  .sort();
if (JSON.stringify(names) !== JSON.stringify(sizes))
  problems.push("Block UI typography and class-merger size names differ.");
let checked = 0;
for (const file of await files(new URL("src", root).pathname)) {
  if (!/\.(tsx|css)$/.test(file) || file.includes("/blockui/")) continue;
  const source = await readFile(file, "utf8");
  checked++;
  for (const [name, pattern] of [
    [
      "legacy palette utility",
      /(?:bg|text|border|ring|fill|stroke)-(?:slate|zinc|gray|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]+/g,
    ],
    ["unmigrated button or select", /<(?:button|select)(?=[\s>])/g],
    ["legacy HSL token wrapper", /hsl\(\s*var\(/g],
    [
      "removed decorative surface",
      /buzz-theme-gradient-underlay|card-texture\.css/g,
    ],
  ]) {
    for (const match of source.matchAll(pattern)) {
      const line = source.slice(0, match.index).split("\n").length;
      problems.push(`${file}:${line}: ${name}: ${match[0]}`);
    }
  }
}
const manifest = JSON.parse(
  await readFile(new URL("src/shared/blockui/font-sources.json", root), "utf8"),
);
for (const face of manifest.sources) {
  const bytes = await readFile(
    new URL(`src/shared/blockui/fonts/${face.output_file}`, root),
  );
  if (createHash("sha256").update(bytes).digest("hex") !== face.expected_sha256)
    problems.push(`Font hash mismatch: ${face.output_file}`);
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Block UI audit passed: ${checked} source files; ${manifest.sources.length} verified font assets.`,
  );
