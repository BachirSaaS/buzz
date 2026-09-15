import { Table as BlockTable } from "@/shared/blockui/components/table";
import * as React from "react";

export function MarkdownTable({ children }: { children?: React.ReactNode }) {
  const tableBlockRef = React.useRef<HTMLDivElement | null>(null);

  return (
    <div
      ref={tableBlockRef}
      className="flex flex-col overflow-x-auto rounded-blockui-lg border border-border bg-card p-6"
      data-table-block=""
      data-content-widget=""
      data-block-media=""
    >
      {/* Inherit message wrap-anywhere for long tokens. The cells' minimum
          widths keep short labels readable; many-column tables scroll locally. */}
      <BlockTable className="w-full border-collapse text-left text-sm">
        {children}
      </BlockTable>
    </div>
  );
}
