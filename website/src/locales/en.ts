const en = {
  nav: { tour: "Tour", features: "Features", safety: "Safety", faq: "FAQ", download: "Download", language: "Language" },
  hero: {
    badge: "Free for Windows · v{version}",
    title: "See what the game",
    titleAccent: "won't tell you.",
    text: "Everything about your Guardian, right next to the game. Radar recognises the weapon, armor or Guardian you're looking at and shows what the game doesn't: every roll, exact numbers, clears, lowmans and builds. Plus loadouts, DIM and Discord one hotkey away.",
    download: "Download for Windows",
    features: "See all features",
    meta: "{size} · Windows 10/11 · Not affiliated with Bungie",
    inAction: "See it in action",
  },
  tour: {
    snippets: [
      {
        title: "Fireteam scanner",
        subtitle: "Clears, ranks and best times of everyone you play with",
        points: [
          "Raid and dungeon full clears, counted from Bungie's own reports",
          "The sum of your best times, per raid and dungeon",
          "Your fireteam and the players of your last activities, one click away",
        ],
      },
      {
        title: "Every lowman, tagged",
        subtitle: "Solo, duo and trio flawless — with the class they were done on",
        points: [
          "Day one, contest and week one clears marked as such",
          "Flawless, master and solo runs, with the feats that were on",
          "The class symbols show every class a tag was earned on",
        ],
      },
      {
        title: "The runs behind a tag",
        subtitle: "One click shows the run — or one per class",
        points: ["Kills, deaths and time for every player", "The weapons each of them used most", "A link to the full report on RaidHub"],
      },
      {
        title: "Every roll at a glance",
        subtitle: "All perks a weapon can roll, and the copies you own",
        points: [
          "Every column of perks, enhanced ones included",
          "Your copies marked in the list",
          "Pick two perks and pull the matching copy from your vault",
        ],
      },
      {
        title: "Search by where it drops",
        subtitle: "source:vaultofglass lists everything a raid, dungeon or planet drops",
        points: ["Weapons and armor in one search", "Names, armor set names and sources, with autocomplete", "Armor sorted by class and slot"],
      },
      {
        title: "What the playerbase uses",
        subtitle: "The most used weapons and perks of the latest 1,000 completions",
        points: ["Raids, dungeons, or both together", "The perks people pick on each weapon, with their share", "Kept up to date in the background"],
      },
      {
        title: "Armor sets with exact numbers",
        subtitle: "Set bonuses with the real values, every copy you own",
        points: [
          "Two- and four-piece bonuses as they actually work",
          "All your copies with their stats, vault included",
          "Double click one to pull it from the vault",
        ],
      },
      {
        title: "Mods and tuning",
        subtitle: "Change mods and see your stats before you equip",
        points: [
          "Exact stats of every mod on hover",
          "Only the mods you can actually insert, sorted by cost",
          "Your stats with this piece against what you wear",
        ],
      },
      {
        title: "All your loadouts",
        subtitle: "In-game slots, DIM loadouts and presets side by side",
        points: ["Equip a loadout with a hotkey, in game", "Save an in-game loadout to DIM with a name", "Presets that switch several loadouts at once"],
      },
      {
        title: "Any Guardian's build",
        subtitle: "Subclass, weapons, armor and stats of anyone you look up",
        points: [
          "Every character of a player",
          "Weapons with their perks, armor with mods and set bonuses",
          "Look someone up by name, or straight from their character screen in game",
        ],
      },
    ],
    tryIt: "Click the app to try it yourself.",
    tryItHint: "A demo with sample data (in English) – some features only work in the real app. Scroll on it or use the arrows for more.",
    swipe: "Swipe, drag or use the arrows · clips from the real app",
    pictures: "Pictures of the app",
    previous: "Previous",
    next: "Next",
    demo: "Radar demo",
    clickToTry: "Click to try it yourself",
    backToTour: "Back to the tour",
  },
  features: {
    kicker: "Features",
    title: "One app instead of five tabs.",
    text: "Built for Destiny 2 on PC, made to stay out of your way.",
    items: [
      {
        title: "Recognises what you look at",
        text: "Inspect a weapon or a piece of armor and a notice shows up over the game. F10 opens the full page for it.",
      },
      {
        title: "Reads Guardian names",
        text: "Open someone's character screen and Radar finds them — underscores, brackets, symbols, Cyrillic and CJK names too.",
      },
      {
        title: "Artifact perks, exact",
        text: "On the artifact screen Radar lists every perk of the season's artifact with what it actually does.",
      },
      {
        title: "Loadouts on a hotkey",
        text: "Equip in-game and DIM loadouts without leaving the game, or switch a whole preset at once.",
      },
      {
        title: "DIM and Discord over the game",
        text: "F6 opens your LFG Discord, F7 opens DIM, right over Destiny. /join codes get a button that copies them.",
      },
      {
        title: "An overlay you place yourself",
        text: "Clock, session stats and the notices go where you want them. Clicks pass straight through to the game.",
      },
      {
        title: "Starts with Destiny",
        text: "Radar waits in the tray and comes up when the game does. Everything is loaded before you land in orbit.",
      },
      {
        title: "Won't slow your game down",
        text: "Radar barely uses your PC: the overlay only draws where its widgets are, and anything you're not using pauses.",
      },
    ],
  },
  safety: {
    kicker: "Safety",
    title: "Hands off the game.",
    text: "Radar sits next to Destiny 2, not inside it. It looks at the screen and asks Bungie — nothing else.",
    items: [
      "Never sends a key press or a click to Destiny 2",
      "Doesn't read or change the game's memory or files",
      "Reads only what's on your screen, like a screenshot",
      "Your data comes from Bungie's official API, as with DIM",
      "Your Bungie login stays on your PC",
    ],
  },
  how: {
    kicker: "How it works",
    title: "Up in a few minutes.",
    steps: [
      { title: "Download", text: "Grab the installer ({size}). No admin rights needed." },
      { title: "Connect Bungie", text: "Log in with your Bungie account once – no keys, nothing to set up." },
      {
        title: "Launch Destiny 2",
        text: "Radar comes up with the game in borderless mode. F10 opens what you look at, F6 Discord, F7 DIM.",
      },
    ],
  },
  faq: {
    kicker: "FAQ",
    title: "Questions, answered.",
    items: [
      {
        q: "Can I get banned for using Radar?",
        a: "Radar doesn't inject anything, doesn't read the game's memory and never sends input to Destiny 2. It reads what is on your screen (like a screenshot) and talks to Bungie's official API — the same way DIM and other companion apps do.",
      },
      { q: "Is it free?", a: "Yes. Radar is free to download and use." },
      {
        q: "What does the Bungie login do?",
        a: "You log in on Bungie's own page – Radar never sees your password. It lets Radar read your vault and inventory and move or equip your gear. The login stays on your PC.",
      },
      {
        q: "Does the overlay cost FPS?",
        a: "A little, as any window over a game does. Radar keeps it as small as it can: the overlay only covers the part of the screen its widgets are in, reads the screen only when something changed, and puts DIM and Discord to sleep while they're hidden. You can turn the overlay off and keep everything else.",
      },
      {
        q: "Does it work with any Guardian name?",
        a: "Radar reads names with its own recognition, built in — no language packs to install. Symbols, Cyrillic and CJK names included. If a name is too fancy to read, you can still look the player up by hand.",
      },
      {
        q: "Which languages does Radar speak?",
        a: "English, German, French, Spanish, Italian, Portuguese (Brazil), Polish and Russian – switch it any time in Settings. Items and activities come from Bungie in the same language.",
      },
      { q: "Which platforms?", a: "Windows 10 and 11, with Destiny 2 on Steam or the Epic Games Store in borderless window mode." },
      {
        q: "Is Radar made by Bungie?",
        a: "No. Radar is a fan-made companion app and is not affiliated with or endorsed by Bungie. Destiny is a trademark of Bungie, Inc.",
      },
    ],
  },
  download: {
    title: "Ready when you are,",
    titleAccent: "Guardian.",
    text: "Download Radar, launch Destiny 2, and everything is there when you land in orbit.",
    button: "Download for Windows",
    version: "Version {version}",
    installer: "{size} installer",
    windows: "Windows 10 / 11",
    free: "Free",
    downloads: "{n} downloads",
    downloadsLive: "Counted live",
    guardians: "{n} Guardians connected",
  },
  footer: {
    legal: "Legal notice",
    privacy: "Privacy",
    disclaimer: "Not affiliated with Bungie. Destiny 2 is a trademark of Bungie, Inc.",
  },
};

export default en;
