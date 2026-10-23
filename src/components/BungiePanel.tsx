import { openUrl } from "@tauri-apps/plugin-opener";
import { useState, type FormEvent } from "react";
import { bungie, BUNGIE_ORIGIN, formatAgo, PLATFORMS, type Snapshot } from "../lib/bungie";
import { useT } from "../lib/i18n";
import { oauth, useOAuth } from "../lib/oauth";
import { isTauri, navigate } from "../lib/tauri";
import { Badge, GlassButton, GlassInput, GlassPanel, PanelHeader } from "./glass";
import { IconLink } from "./icons";
import { useNow } from "./widgets";

const DEVELOPER_PORTAL = "https://www.bungie.net/en/Application";

/** Runs an async action, tracking busy state and turning rejections into a message. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function ErrorText({ children }: { children: string | null }) {
  if (!children) return null;
  return (
    <p className="mt-2.5 rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-[12.5px] text-red-200">
      {children}
    </p>
  );
}

function ApiKeyStep({ onDone }: { onDone?: () => void }) {
  const t = useT();
  const [key, setKey] = useState("");
  const { busy, error, run } = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => bungie.setApiKey(key))) onDone?.();
  };

  return (
    <form onSubmit={submit}>
      <ol className="mb-3.5 space-y-1.5 text-[12.5px] text-white/60">
        <li>
          <span className="mr-1.5 text-(--accent-text)">1</span>
          {t("bungie.step1")}
        </li>
        <li>
          <span className="mr-1.5 text-(--accent-text)">2</span>
          {t("bungie.step2")}
        </li>
      </ol>
      <div className="flex gap-2">
        <GlassInput
          type="password"
          placeholder={t("bungie.apiKey")}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoComplete="off"
        />
        <GlassButton type="submit" variant="primary" disabled={busy || !key.trim()}>
          {busy ? t("bungie.checking") : t("bungie.save")}
        </GlassButton>
      </div>
      <ErrorText>{error}</ErrorText>
      <button
        type="button"
        onClick={() => (isTauri ? void openUrl(DEVELOPER_PORTAL) : window.open(DEVELOPER_PORTAL))}
        className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] text-(--accent-text) hover:underline"
      >
        <IconLink /> {t("bungie.openPortal")}
      </button>
    </form>
  );
}

function PlayerStep() {
  const t = useT();
  const [name, setName] = useState("");
  const { busy, error, run } = useAction();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => bungie.findPlayer(name));
      }}
    >
      <p className="mb-3 text-[12.5px] text-white/60">{t("bungie.enterName")}</p>
      <div className="flex gap-2">
        <GlassInput
          placeholder="Name#1234"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <GlassButton type="submit" variant="primary" disabled={busy || !name.includes("#")}>
          {busy ? t("bungie.searching") : t("bungie.connect")}
        </GlassButton>
      </div>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}

/** The Bungie login (inventory, rolls) is separate from the public connection. */
function LoginRow() {
  const t = useT();
  const status = useOAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const login = async () => {
    setBusy(true);
    setError(null);
    try {
      await oauth.login();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium">{t("login.title")}</div>
          <div className="text-[12px] text-white/50">{t("login.subtitle")}</div>
        </div>
        {status.loggedIn ? (
          <Badge tone="live">{t("login.loggedIn")}</Badge>
        ) : status.configured ? (
          <GlassButton size="sm" variant="primary" onClick={() => void login()} disabled={busy || !isTauri}>
            {busy ? t("login.waiting") : t("login.login")}
          </GlassButton>
        ) : (
          <GlassButton size="sm" onClick={() => navigate("settings")}>
            {t("login.setUp")}
          </GlassButton>
        )}
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

function ConnectedView({ snapshot }: { snapshot: Snapshot }) {
  const t = useT();
  const now = useNow();
  const { player, character } = snapshot;
  if (!player) return null;

  return (
    <div>
      <div className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-3">
        <div className="size-12 shrink-0 overflow-hidden rounded-xl bg-(--accent-soft) shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)]">
          {character?.emblemPath && (
            <img src={BUNGIE_ORIGIN + character.emblemPath} alt="" className="size-full object-cover" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold">{player.displayName}</div>
          <div className="truncate text-[12px] text-white/50">
            {PLATFORMS[player.membershipType] ?? t("common.unknown")}
            {character && ` · ${character.className} · ◆ ${character.light}`}
          </div>
        </div>
      </div>

      <div className="mt-2.5 text-[12px] text-white/45">
        {snapshot.updatedAt
          ? t("bungie.updated", { ago: formatAgo(snapshot.updatedAt, now, t) })
          : t("bungie.loadingData")}
      </div>
      {snapshot.status === "error" && <ErrorText>{snapshot.error}</ErrorText>}

      <div className="mt-3 flex flex-wrap gap-2">
        <GlassButton size="sm" onClick={() => void bungie.refresh()}>
          {t("bungie.refreshNow")}
        </GlassButton>
        <GlassButton size="sm" onClick={() => void bungie.resetSession()}>
          {t("bungie.resetSession")}
        </GlassButton>
        <GlassButton size="sm" variant="danger" onClick={() => void bungie.clearPlayer()}>
          {t("bungie.disconnect")}
        </GlassButton>
      </div>
      <LoginRow />
    </div>
  );
}

export function BungiePanel({ snapshot }: { snapshot: Snapshot }) {
  const t = useT();
  const [changingKey, setChangingKey] = useState(false);

  const badge =
    snapshot.status === "unconfigured" ? (
      <Badge>{t("bungie.notConnected")}</Badge>
    ) : snapshot.status === "error" ? (
      <Badge tone="error">{t("common.error")}</Badge>
    ) : (
      <Badge tone="live">{t("bungie.connected")}</Badge>
    );

  let body;
  if (!snapshot.hasApiKey || changingKey) body = <ApiKeyStep onDone={() => setChangingKey(false)} />;
  else if (!snapshot.player) body = <PlayerStep />;
  else body = <ConnectedView snapshot={snapshot} />;

  return (
    <GlassPanel className="p-5">
      <PanelHeader icon={<IconLink />} title="Bungie.net" subtitle={t("bungie.subtitle")} right={badge} />
      {body}
      {snapshot.hasApiKey && !snapshot.apiKeyBuiltIn && !changingKey && (
        <button
          onClick={() => setChangingKey(true)}
          className="mt-3 text-[12px] text-white/40 hover:text-white/70"
        >
          {t("bungie.changeKey")}
        </button>
      )}
    </GlassPanel>
  );
}
