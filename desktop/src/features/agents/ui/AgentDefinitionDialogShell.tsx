import type * as React from "react";

import { ChooserDialogContent } from "@/shared/ui/chooser-dialog-content";
import { Dialog } from "@/shared/ui/dialog";

type AgentDefinitionDialogShellProps = {
  children: React.ReactNode;
  description: string;
  embedded: boolean;
  footer: React.ReactNode;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
};

export function AgentDefinitionDialogShell({
  children,
  description,
  embedded,
  footer,
  onOpenChange,
  open,
  title,
}: AgentDefinitionDialogShellProps) {
  if (embedded) {
    return (
      <div
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
        data-testid="persona-dialog"
      >
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-6">
          {children}
        </div>
        <div className="flex shrink-0 justify-end border-t border-border bg-card p-6">
          {footer}
        </div>
      </div>
    );
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <ChooserDialogContent
        className="max-w-3xl rounded-blockui-lg border border-border bg-card"
        contentClassName="py-6"
        data-testid="persona-dialog"
        description={description}
        footer={footer}
        footerClassName="p-6"
        headerClassName="p-6 pr-16 [&_h2]:text-base [&_h2]:font-semibold"
        title={title}
      >
        {children}
      </ChooserDialogContent>
    </Dialog>
  );
}
