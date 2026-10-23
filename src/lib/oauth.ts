import { useEffect, useState } from "react";
import { call, isTauri, subscribe } from "./tauri";

export interface OAuthStatus {
  /** Client id and secret are set. */
  configured: boolean;
  loggedIn: boolean;
  clientId: string | null;
  /** The client is Radar's own (nothing to enter or change). */
  builtIn?: boolean;
}

const EMPTY: OAuthStatus = { configured: false, loggedIn: false, clientId: null };

export function useOAuth(): OAuthStatus {
  const [status, setStatus] = useState<OAuthStatus>(EMPTY);
  useEffect(() => {
    if (!isTauri) return;
    void call<OAuthStatus>("oauth_status").then((s) => s && setStatus(s));
    return subscribe<OAuthStatus>("oauth-changed", setStatus);
  }, []);
  return status;
}

export const oauth = {
  setClient: (clientId: string, clientSecret: string) =>
    call<OAuthStatus>("oauth_set_client", { clientId, clientSecret }),
  login: () => call<OAuthStatus>("oauth_login"),
  logout: () => call<OAuthStatus>("oauth_logout"),
};
