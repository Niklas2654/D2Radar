import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Overlay } from "./Overlay";
import { autoHideScrollbars } from "./lib/scrollbars";
import "./styles.css";

autoHideScrollbars();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Overlay />
  </StrictMode>,
);
