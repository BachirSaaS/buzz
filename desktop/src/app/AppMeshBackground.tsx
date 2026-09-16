import { useEffect, useState } from "react";
import { MeshGradient } from "@paper-design/shaders-react";
import { useReducedMotion } from "motion/react";
import { useAppFocused } from "@/shared/lib/useDocumentVisible";

const COLORS = ["#bcecf6", "#00aaff"];

/** Paper's mesh preset, shared behind all desktop workspaces. */
export function AppMeshBackground() {
  const reducedMotion = useReducedMotion();
  const focused = useAppFocused();
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    // Paper requires WebGL 2. Keep the color fallback on unsupported devices.
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2");
    setSupported(Boolean(context));
    context?.getExtension("WEBGL_lose_context")?.loseContext();
  }, []);
  const speed = focused && !reducedMotion ? 0.1 : 0;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      data-testid="app-mesh-background"
      data-animated={supported && speed > 0}
      style={{ background: "linear-gradient(135deg, #bcecf6, #00aaff)" }}
    >
      {supported && (
        <MeshGradient
          width="100%"
          height="100%"
          colors={COLORS}
          distortion={0.59}
          swirl={0}
          grainMixer={0.5}
          grainOverlay={0.02}
          speed={speed}
          scale={0.92}
          rotation={0}
          offsetX={0}
          offsetY={0}
          minPixelRatio={1}
          maxPixelCount={2_073_600}
        />
      )}
    </div>
  );
}
