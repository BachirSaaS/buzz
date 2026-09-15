import { MessagesSquare } from "lucide-react";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyDescription,
} from "@/shared/blockui/components/empty";
export function ChannelScreenEmptyState() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MessagesSquare />
        </EmptyMedia>
        <EmptyDescription>Select a channel to view messages.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
