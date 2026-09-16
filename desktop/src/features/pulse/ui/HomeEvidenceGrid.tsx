import type { ReactNode } from "react";
import { LinkPreviewStyleContext } from "@/shared/lib/linkPreviewStylePreference";

/** A shared, compact view of the original messages behind a Home card. */
export function HomeEvidenceGrid({ children }: { children: ReactNode }) {
  return (
    <LinkPreviewStyleContext.Provider value="rich">
      <div
        className="home-activity-evidence grid max-h-[240px] min-w-0 grid-cols-1 items-start gap-4 overflow-hidden sm:grid-cols-2"
        data-testid="home-activity-evidence"
      >
        {children}
      </div>
    </LinkPreviewStyleContext.Provider>
  );
}

export function HomeEvidencePreview({ children }: { children: ReactNode }) {
  return (
    <div data-testid="home-context-preview" style={{ zoom: 0.5 }}>
      {children}
    </div>
  );
}
