import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/shared/ui/button";
export function PulseWindowActions({
  onRefresh,
  refreshing,
}: {
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHost(document.getElementById("app-top-chrome-content"));
  }, []);
  if (!host) return null;
  return createPortal(
    <div data-pulse-window-actions className="ml-auto flex items-center">
      <Button
        variant="ghost"
        size="icon"
        className="size-8 rounded-full"
        aria-label="Refresh messages"
        title="Refresh messages"
        onClick={onRefresh}
        disabled={refreshing}
      >
        <RefreshCw
          aria-hidden
          className={
            refreshing
              ? "size-4 animate-spin motion-reduce:animate-none"
              : "size-4"
          }
        />
      </Button>
    </div>,
    host,
  );
}
