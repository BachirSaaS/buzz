import * as React from "react";
import { createPortal } from "react-dom";

const APP_TOP_CHROME_CONTENT_ID = "app-top-chrome-content";
const APP_TOP_CHROME_TRAILING_ID = "app-top-chrome-trailing";

export function AppTopChromePortal({
  children,
  slot = "content",
}: {
  children: React.ReactNode;
  slot?: "content" | "trailing";
}) {
  const [target, setTarget] = React.useState<HTMLElement | null>(null);

  React.useEffect(() => {
    setTarget(
      document.getElementById(
        slot === "trailing"
          ? APP_TOP_CHROME_TRAILING_ID
          : APP_TOP_CHROME_CONTENT_ID,
      ),
    );
  }, [slot]);

  return target ? createPortal(children, target) : null;
}
