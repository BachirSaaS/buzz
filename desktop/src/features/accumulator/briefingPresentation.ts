import { fromMarkdown } from "mdast-util-from-markdown";

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
};
function plainText(node: MarkdownNode): string {
  if (node.type === "html") return "";
  if (node.value !== undefined) return node.value;
  const inline = [
    "paragraph",
    "heading",
    "strong",
    "emphasis",
    "link",
    "linkReference",
  ].includes(node.type);
  return (node.children ?? []).map(plainText).join(inline ? "" : "\n");
}

/** Split explicit list items, retaining prose as one item instead of guessing claim boundaries. */
export function briefingPresentation(output: string, shownIds: string[]) {
  const root = fromMarkdown(output);
  const nodes =
    root.children.length > 0 &&
    root.children.every((node) => node.type === "list")
      ? root.children.flatMap((node) =>
          node.type === "list" ? node.children : [],
        )
      : [root];
  const allowed = new Set(shownIds.filter((id) => /^[a-f0-9]{64}$/.test(id)));
  return nodes
    .map((node, index) => {
      const sources: string[] = [];
      let unavailable = false;
      const text = plainText(node)
        .replace(/\[event:([^\]\s]+)\]/g, (_, id: string) => {
          if (!allowed.has(id)) unavailable = true;
          else if (!sources.includes(id)) sources.push(id);
          return "";
        })
        .replace(/\s+/g, " ")
        .trim();
      return { key: String(index), text, sources, unavailable };
    })
    .filter((item) => item.text || item.sources.length || item.unavailable);
}
