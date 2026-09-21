import type { WindowCatalogEntry } from "../lib/windowCatalog";

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Derive slots only when every comma/newline-delimited item is an unambiguous catalog name. */
export function explicitWindowList(
  request: string,
  catalog: WindowCatalogEntry[],
): WindowCatalogEntry[] | undefined {
  const parts = request.split(/[,\n]/).map((part) => normalize(part));
  if (parts.length < 2 || parts.length > 8 || parts.some((part) => !part))
    return undefined;
  const selected: WindowCatalogEntry[] = [];
  for (const part of parts) {
    const matches = catalog.filter((entry) =>
      [entry.title, ...entry.aliases].some((name) => normalize(name) === part),
    );
    if (matches.length !== 1) return undefined;
    if (!selected.some((entry) => entry.id === matches[0].id))
      selected.push(matches[0]);
  }
  return selected;
}
