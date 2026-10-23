import { Analytics } from "@vercel/analytics/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { savedAccent, applyAccent } from "./fx";
import "./styles.css";

// The colour picked before, set before the first paint (no flash of Void).
const accent = savedAccent();
if (accent) applyAccent(accent, false);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    {/* Visitor counts (Vercel Web Analytics: no cookies; see the privacy policy). */}
    <Analytics />
  </StrictMode>,
);
