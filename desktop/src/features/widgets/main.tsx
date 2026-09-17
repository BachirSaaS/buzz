import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../shared/blockui/theme.css";
import "./widgets.css";
import "./gallery-entry.css";
import { WidgetGallery } from "./WidgetGallery";

const root = document.getElementById("root");
if (!root) throw new Error("The widget gallery root is missing.");
createRoot(root).render(
  <StrictMode>
    <WidgetGallery />
  </StrictMode>,
);
