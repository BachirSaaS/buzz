import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { LinkPreviewWidget } from "@/shared/ui/link-preview-widget";
import { NativeSelect } from "@/shared/blockui/components/native-select";
import { Button } from "@/shared/ui/button";
import type { LinkPreviewImageState } from "@/shared/lib/useResolvedLinkPreviews";
import { linkCardSamples, sampleImage } from "./linkCardSamples";
import "@/shared/styles/globals.css";
import "@/shared/blockui/fonts.css";

function LinkCardGallery() {
  const [dark, setDark] = useState(false);
  const [layout, setLayout] = useState("rich");
  const [imageState, setImageState] = useState<LinkPreviewImageState>("none");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  return (
    <main className="h-dvh overflow-y-auto bg-background text-foreground">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 p-6 md:p-12">
        <header className="flex flex-col gap-4">
          <p className="text-xs font-medium text-muted-foreground">
            Buzz · Local design preview
          </p>
          <h1 className="text-blockui-page-title">Link cards</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            All 14 supported link types, rendered with the same components used
            in messages. These are sample titles and descriptions; no account or
            live data is loaded.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="secondary" onClick={() => setDark(!dark)}>
              {dark ? "Light mode" : "Dark mode"}
            </Button>
            <div className="flex items-center gap-2 text-sm">
              <label htmlFor="gallery-layout">Layout</label>
              <NativeSelect
                id="gallery-layout"
                value={layout}
                onChange={(e) => setLayout(e.target.value)}
              >
                <option value="rich">Messages</option>
                <option value="compact">Compact</option>
                <option value="home">Home · 50%</option>
              </NativeSelect>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <label htmlFor="gallery-image-state">Image state</label>
              <NativeSelect
                id="gallery-image-state"
                value={imageState}
                onChange={(e) =>
                  setImageState(e.target.value as LinkPreviewImageState)
                }
              >
                <option value="none">Text only</option>
                <option value="image">Sample image</option>
                <option value="pending">Loading</option>
                <option value="fallback">Unavailable</option>
              </NativeSelect>
            </div>
          </div>
          <p
            aria-live="polite"
            className="min-h-5 text-xs text-muted-foreground"
          >
            {notice ||
              "Use each card’s menu to collapse it or switch to a compact preview. Sample links stay in this gallery."}
          </p>
        </header>
        <div className="grid items-start gap-8 md:grid-cols-2">
          {linkCardSamples.map((sample) => (
            <section
              key={sample.kind}
              aria-label={sample.kind}
              className="flex min-w-0 flex-col gap-4"
            >
              <h2 className="text-sm font-medium capitalize">
                {sample.kind.replaceAll("-", " ")}
              </h2>
              <div
                className={
                  layout === "home"
                    ? "max-h-60 overflow-hidden rounded-blockui-lg"
                    : ""
                }
              >
                <div style={layout === "home" ? { zoom: 0.5 } : undefined}>
                  <LinkPreviewWidget
                    compact={layout === "compact"}
                    preview={{
                      ...sample,
                      imageState,
                      imageDataUrl: imageState === "image" ? sampleImage : null,
                      imageDomain: sample.provider,
                    }}
                    onOpen={() => setNotice(`Sample only: ${sample.title}`)}
                  />
                </div>
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<LinkCardGallery />);
