import { useCallback, useEffect, useState } from "react";
import { call, isTauri, subscribe } from "./tauri";

export interface OverlayState {
  /** The user's switch; the overlay only appears while the game runs. */
  visible: boolean;
  edit: boolean;
  gameRunning: boolean;
}

/** Overlay visibility / edit mode, owned by the Rust side. */
export function useOverlayState() {
  const [state, setState] = useState<OverlayState>({ visible: true, edit: false, gameRunning: true });

  useEffect(() => {
    void call<OverlayState>("get_overlay_state").then((s) => s && setState(s));
    return subscribe<OverlayState>("overlay-state", setState);
  }, []);

  // Browser-only fallback so the UI can be developed without Tauri:
  // F9 toggles edit mode locally.
  useEffect(() => {
    if (isTauri) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F9") setState((s) => ({ ...s, edit: !s.edit }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const setVisible = useCallback((visible: boolean) => {
    if (isTauri) void call("set_overlay_visible", { visible });
    else setState((s) => ({ ...s, visible }));
  }, []);

  const setEdit = useCallback((on: boolean) => {
    if (isTauri) void call("set_edit_mode", { on });
    else setState((s) => ({ ...s, edit: on }));
  }, []);

  return { ...state, setVisible, setEdit };
}
