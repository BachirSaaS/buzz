import { ChevronDown, Hash, MessageSquarePlus } from "lucide-react";

import { WorkspaceSidebarButton } from "@/shared/ui/workspace-sidebar-button";
import { PulseSidebarIcon } from "./PulseChannelAvatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

/** Starts a new conversation from the persistent Messages sidebar. */
export function MessagesSidebarNewMenu({
  onChannel,
  onDirectMessage,
}: {
  onChannel: () => void;
  onDirectMessage: () => void;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <WorkspaceSidebarButton
          active={false}
          type="button"
          className="mb-2"
          data-testid="messages-new-message"
        >
          <PulseSidebarIcon icon={MessageSquarePlus} />
          <span>New message</span>
          <ChevronDown aria-hidden="true" className="ml-auto size-3.5" />
        </WorkspaceSidebarButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        <DropdownMenuItem onSelect={onDirectMessage}>
          <MessageSquarePlus aria-hidden="true" />
          Direct message
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onChannel}>
          <Hash aria-hidden="true" />
          Channel
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
