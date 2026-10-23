# Radar

A free Destiny 2 companion for Windows: every roll, exact numbers, clears, lowmans,
loadouts – plus DIM and Discord one hotkey away.

**[Download the latest version](https://github.com/Niklas2654/D2Radar/releases/latest/download/Radar-setup.exe)** ·
Windows 10/11 · [Website](https://d2radar.vercel.app)

Radar updates itself (Settings → About → Check for updates).

## What it does

- **Fireteam scanner** – clears, best times and lowman tags of everyone you play with
- **Database** – every perk a weapon can roll, armor sets with exact numbers, your own copies
- **Loadouts** – in-game loadouts, DIM loadouts and presets, equipped with a hotkey
- **In-game overlay** – recognises the weapon, armor or Guardian you inspect and shows what the game doesn't
- **DIM and Discord** inside Radar, also over the game

## Safe to use

- Radar **never reads or changes the game's memory** and sends no input to Destiny 2.
- It looks at the screen (like a screenshot) and reads it with the text recognition built into
  Windows – only on your PC.
- It talks to **Bungie's official API**, like DIM and other companion apps.
- There is **no Radar server**: no account, no analytics, no tracking in the app.
  Your settings and your Bungie login stay on your PC.

This is all in the code here, for anyone to check. Details on every connection the app makes
are in the [privacy policy](https://d2radar.vercel.app/privacy).

Windows may show "Windows protected your PC" when installing: Radar is new and not yet
code-signed. Click **More info → Run anyway**.

## Building it yourself

Needs [Node.js](https://nodejs.org) 24, [pnpm](https://pnpm.io), [Rust](https://rustup.rs) and
the [Tauri prerequisites for Windows](https://tauri.app/start/prerequisites/).

```bash
pnpm install
pnpm tauri dev      # run it
pnpm tauri build    # the installer, in src-tauri/target/release/bundle/nsis
```

Radar talks to Bungie with its own registered app. To build with yours, register one at
[bungie.net/en/Application](https://www.bungie.net/en/Application) (OAuth client type
*Confidential*) and put its values in `src-tauri/bungie.local.json` (not checked in):

```json
{ "apiKey": "…", "clientId": "…", "clientSecret": "…" }
```

Without it, the app asks for an API key (Overview) and an OAuth client (Settings).

The website (with a demo of the app running on sample data) is in `website/`:

```bash
pnpm --dir website install
pnpm --dir website build:app   # the app's demo build, into website/public/app
pnpm --dir website dev
```

## License

Radar is licensed under the [GNU General Public License v3.0 or later](LICENSE).
Third-party material and its licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Radar is a fan project and is not affiliated with or endorsed by Bungie.
Destiny is a trademark of Bungie, Inc.
