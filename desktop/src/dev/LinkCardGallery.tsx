import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { LinkPreviewWidget } from "@/shared/ui/link-preview-widget";
import { Button } from "@/shared/ui/button";
import { linkCardSamples } from "./linkCardSamples";
import "@/shared/styles/globals.css";
import "@/shared/blockui/fonts.css";
import "@/features/messages/ui/MessageBubbleLayout.css";

function LinkCardGallery() {
  const [dark, setDark] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  return (
    <main className="h-dvh overflow-y-auto bg-background text-foreground">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 p-6 md:p-12">
        <header className="flex flex-col items-start gap-4">
          <p className="text-xs font-medium text-muted-foreground">
            Buzz · Local design preview
          </p>
          <h1 className="text-blockui-page-title">Link bubbles</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            All 14 link types in incoming and outgoing message bubbles. A title
            and source, without large images or descriptions. Sample content
            only.
          </p>
          <Button variant="secondary" onClick={() => setDark(!dark)}>
            {dark ? "Light mode" : "Dark mode"}
          </Button>
          <p
            aria-live="polite"
            className="min-h-5 text-xs text-muted-foreground"
          >
            {notice ||
              "Click a bubble to try it. Sample links stay in this gallery."}
          </p>
        </header>
        <div className="grid items-start gap-8 md:grid-cols-2">
          {linkCardSamples.map((sample) => (
            <section
              key={sample.kind}
              aria-label={sample.kind}
              className="flex min-w-0 flex-col gap-3"
            >
              <h2 className="text-sm font-medium capitalize">
                {sample.kind.replaceAll("-", " ")}
              </h2>
              {(["incoming", "outgoing"] as const).map((direction) => (
                <div
                  key={direction}
                  className={`message-bubble-anchor flex min-w-0 ${direction === "outgoing" ? "justify-end" : ""}`}
                  data-bubble-direction={direction}
                >
                  <LinkPreviewWidget
                    preview={sample}
                    onOpen={() => setNotice(`Sample only: ${sample.title}`)}
                  />
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<LinkCardGallery />);
