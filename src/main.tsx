import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { InspectWindow } from "./InspectWindow";
import { followPointerLight } from "./lib/glassLight";
import { pauseWhenIdle } from "./lib/idle";
import { autoHideScrollbars } from "./lib/scrollbars";
import "./styles.css";

autoHideScrollbars();
followPointerLight();
pauseWhenIdle();

// The inspect page over the game is its own window (inspect.rs).
const inspect = new URLSearchParams(location.search).has("inspect");
// Over the game: see-through around its page (the window is transparent).
if (inspect) document.body.classList.add("inspect-body");

createRoot(document.getElementById("root")!).render(
  <StrictMode>{inspect ? <InspectWindow /> : <App />}</StrictMode>,
);
