import { useState, type FormEvent } from "react";
import { useT } from "../lib/i18n";
import { oauth, useOAuth } from "../lib/oauth";
import { isTauri } from "../lib/tauri";
import { Badge, GlassButton, GlassInput, GlassPanel, PanelHeader } from "./glass";
import { IconLink } from "./icons";

/**
 * Bungie login (OAuth) for private data: inventory and vault, i.e. the
 * player's actual weapon rolls.
 */
export function BungieLoginPanel() {
  const t = useT();
  const status = useOAuth();
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveClient = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await oauth.setClient(clientId, secret);
      setSecret("");
      setEditing(false);
    });
  };

  const showForm = !status.builtIn && (!status.configured || editing);

  return (
    <GlassPanel className="p-5">
      <PanelHeader
        icon={<IconLink />}
        title={t("login.title")}
        subtitle={t("login.subtitle")}
        right={status.loggedIn ? <Badge tone="live">{t("login.loggedIn")}</Badge> : <Badge>{t("login.loggedOut")}</Badge>}
      />

      {showForm ? (
        <form onSubmit={saveClient}>
          <ol className="mb-3.5 space-y-1.5 text-[12.5px] text-white/60">
            <li>
              <span className="mr-1.5 text-(--accent-text)">1</span>
              {t("login.step1")}
            </li>
            <li>
              <span className="mr-1.5 text-(--accent-text)">2</span>
              {t("login.step2")}
            </li>
          </ol>
          <div className="flex flex-col gap-2">
            <GlassInput placeholder="OAuth client_id" value={clientId} onChange={(e) => setClientId(e.target.value)} />
            <div className="flex gap-2">
              <GlassInput
                type="password"
                autoComplete="off"
                placeholder="OAuth client_secret"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
              <GlassButton type="submit" variant="primary" disabled={busy || !clientId.trim() || !secret.trim()}>
                {t("bungie.save")}
              </GlassButton>
            </div>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {status.loggedIn ? (
            <GlassButton onClick={() => void run(oauth.logout)} variant="danger" disabled={busy}>
              {t("login.logout")}
            </GlassButton>
          ) : (
            <GlassButton onClick={() => void run(oauth.login)} variant="primary" disabled={busy || !isTauri}>
              {busy ? t("login.waiting") : t("login.login")}
            </GlassButton>
          )}
          {!status.builtIn && (
            <button onClick={() => setEditing(true)} className="text-[12px] text-white/40 hover:text-white/70">
              {t("login.changeClient")}
            </button>
          )}
        </div>
      )}
      {!status.loggedIn && status.configured && !editing && (
        <p className="mt-2.5 text-[12px] text-white/45">{t("login.hint")}</p>
      )}
      {error && <p className="mt-2.5 text-[12.5px] text-red-300">{error}</p>}
    </GlassPanel>
  );
}
