import { TableHeader as BlockTableHeader } from "@/shared/blockui/components/table";
import { TableRow as BlockTableRow } from "@/shared/blockui/components/table";
import { TableHead as BlockTableHead } from "@/shared/blockui/components/table";
export const WORK_ITEM_TABLE_GRID_CLASS =
  "grid w-full grid-cols-[minmax(0,1fr)_5.5rem_4.5rem_3rem_5rem_1.5rem] items-center gap-x-3";

export function ProjectsWorkItemTableHeader({
  itemLabel,
  typeLabel,
}: {
  itemLabel: string;
  typeLabel: string;
}) {
  return (
    <BlockTableHeader className="sr-only">
      <BlockTableRow>
        <BlockTableHead scope="col">{itemLabel}</BlockTableHead>
        <BlockTableHead scope="col">{typeLabel}</BlockTableHead>
        <BlockTableHead scope="col">Status</BlockTableHead>
        <BlockTableHead scope="col">Replies</BlockTableHead>
        <BlockTableHead scope="col">Updated</BlockTableHead>
        <BlockTableHead scope="col">Actions</BlockTableHead>
      </BlockTableRow>
    </BlockTableHeader>
  );
}
