import type { Strings } from "../i18n";

const de: Strings = {
  nav: { tour: "Tour", features: "Funktionen", safety: "Sicherheit", faq: "FAQ", download: "Download", language: "Sprache" },
  hero: {
    badge: "Kostenlos für Windows · v{version}",
    title: "Sieh, was dir das Spiel",
    titleAccent: "nicht verrät.",
    text: "Alles über deinen Hüter, direkt neben dem Spiel. Radar erkennt die Waffe, Rüstung oder den Hüter, den du dir ansiehst, und zeigt, was das Spiel nicht zeigt: jeden Roll, exakte Zahlen, Clears, Lowmans und Builds. Dazu alle Loadouts an einem Ort und DIM und Discord nur einen Hotkey entfernt.",
    download: "Download für Windows",
    tour: "Zur Tour",
    meta: "{size} · Windows 10/11 · Nicht mit Bungie verbunden",
    inAction: "So sieht es aus",
  },
  tour: {
    kicker: "Die Tour",
    title: "Scroll durch die echte App.",
    text: "Kapitel für Kapitel, vom Fireteam bis zum Overlay im Spiel.",
    chapters: [
      {
        name: "Fireteam",
        title: "Wisse, mit wem du spielst.",
        text: "Clears, Lowmans, Bestzeiten und der Build jedes Hüters – deiner, die deines Fireteams und von jedem, den du nachschlägst.",
      },
      {
        name: "Datenbank",
        title: "Jede Waffe und Rüstung, mit echten Zahlen.",
        text: "Alle Rolls, Quellen und exakte Perk-Werte, direkt neben deinen eigenen Exemplaren.",
      },
      {
        name: "Loadouts",
        title: "Alle deine Loadouts an einem Ort.",
        text: "Ingame-Slots, DIM-Loadouts und Presets – ausrüsten, speichern und bauen, ohne Radar zu verlassen.",
      },
      {
        name: "Rüstungs-Optimizer",
        title: "Die beste Rüstung für die Werte, die du willst.",
        text: "Leg deine Ziele fest, und Radar durchsucht deinen ganzen Tresor nach den Builds, die sie erreichen.",
      },
      {
        name: "Im Spiel",
        title: "Direkt über dem Spiel.",
        text: "Fahr über eine Waffe oder ein Rüstungsteil wie im Spiel: Radar erkennt es und zeigt seinen Hinweis. Klick es an oder drück F10 für Radars Seite dazu. Öffne auch das Artefakt.",
      },
    ],
    snippets: [
      {
        title: "Fireteam-Scanner",
        subtitle: "Clears, Ränge und Bestzeiten von allen, mit denen du spielst",
        points: [
          "Raid- und Dungeon-Full-Clears, gezählt aus Bungies eigenen Berichten",
          "Die Summe deiner Bestzeiten, pro Raid und Dungeon",
          "Dein Fireteam und die Spieler deiner letzten Aktivitäten, einen Klick entfernt",
        ],
      },
      {
        title: "Jeder Lowman, markiert",
        subtitle: "Solo, Duo und Trio Flawless – mit der Klasse, auf der sie geschafft wurden",
        points: [
          "Day-One-, Contest- und Week-One-Clears als solche markiert",
          "Flawless-, Meister- und Solo-Runs, mit den Feats, die an waren",
          "Die Klassensymbole zeigen jede Klasse, auf der ein Tag verdient wurde",
        ],
      },
      {
        title: "Die Runs hinter einem Tag",
        subtitle: "Ein Klick zeigt den Run – oder einen pro Klasse",
        points: ["Kills, Tode und Zeit für jeden Spieler", "Die Waffen, die jeder am meisten benutzt hat", "Ein Link zum vollen Bericht auf RaidHub"],
      },
      {
        title: "Jeder Roll auf einen Blick",
        subtitle: "Alle Perks, die eine Waffe rollen kann, und deine eigenen Exemplare",
        points: [
          "Jede Perk-Spalte, verbesserte Perks inklusive",
          "Deine Exemplare in der Liste markiert",
          "Zwei Perks wählen und das passende Exemplar aus dem Tresor holen",
        ],
      },
      {
        title: "Suche nach Herkunft",
        subtitle: "source:vaultofglass listet alles, was ein Raid, Dungeon oder Planet droppt",
        points: ["Waffen und Rüstung in einer Suche", "Namen, Rüstungsset-Namen und Quellen, mit Autovervollständigung", "Rüstung nach Klasse und Slot sortiert"],
      },
      {
        title: "Was die Spieler nutzen",
        subtitle: "Die meistgenutzten Waffen und Perks der letzten 1.000 Abschlüsse",
        points: ["Raids, Dungeons oder beides zusammen", "Die Perks, die Spieler auf jeder Waffe wählen, mit ihrem Anteil", "Im Hintergrund aktuell gehalten"],
      },
      {
        title: "Rüstungssets mit exakten Zahlen",
        subtitle: "Set-Boni mit den echten Werten, jedes deiner Exemplare",
        points: [
          "Zwei- und Vier-Teile-Boni, so wie sie wirklich funktionieren",
          "Alle deine Exemplare mit ihren Werten, Tresor inklusive",
          "Doppelklick holt eines aus dem Tresor",
        ],
      },
      {
        title: "Mods und Tuning",
        subtitle: "Mods ändern und deine Werte sehen, bevor du ausrüstest",
        points: [
          "Exakte Werte jeder Mod beim Drüberfahren",
          "Nur die Mods, die du wirklich einsetzen kannst, nach Kosten sortiert",
          "Deine Werte mit diesem Teil im Vergleich zu dem, was du trägst",
        ],
      },
      {
        title: "Alle deine Loadouts",
        subtitle: "Ingame-Slots, DIM-Loadouts und Presets nebeneinander",
        points: ["Jedes Loadout mit einem Klick ausrüsten", "Ein Ingame-Loadout mit Namen in DIM speichern", "Presets, die mehrere Loadouts auf einmal wechseln"],
      },
      {
        title: "Der Build jedes Hüters",
        subtitle: "Subklasse, Waffen, Rüstung und Werte von jedem, den du nachschlägst",
        points: [
          "Jeder Charakter eines Spielers",
          "Waffen mit ihren Perks, Rüstung mit Mods und Set-Boni",
          "Jemanden per Name suchen – oder direkt von seinem Charakterbildschirm im Spiel",
        ],
      },
      {
        title: "Ein Loadout bauen",
        subtitle: "Slot für Slot – Waffen, Rüstung, Subklasse und Artefakt",
        points: [
          "Starte mit dem, was du trägst, oder ganz von vorn",
          "Waffen mit den Perks, die du wählst – beim Ausrüsten gesetzt",
          "Speichern und später mit einem Klick ausrüsten",
        ],
      },
      {
        title: "Rüstung für die Werte, die du willst",
        subtitle: "Mindestwerte festlegen, und Radar kombiniert deinen ganzen Tresor",
        points: [
          "Zeigt, wie hoch jeder Wert noch gehen kann",
          "Jedes Teil auf deinen Charakteren und im Tresor zählt",
          "Meisterwerk, Mods und Tier-5-Tuning eingerechnet",
        ],
      },
      {
        title: "Dein Build, deine Regeln",
        subtitle: "Exotic, Set-Boni und feste Mods – der Rest wird drumherum berechnet",
        points: [
          "Wähl ein Exotic – oder lass Radar eines aussuchen",
          "Verlang einen Set-Bonus: So viele Teile stecken dann in jedem Build",
          "Ein Teil oder eine Mod selbst festlegen – oder eines ausschließen",
        ],
      },
      {
        title: "Jeder Build im Detail",
        subtitle: "Was jedes Teil beiträgt, was es kostet und was du bekommst",
        points: [
          "Werte pro Teil: Roll, Meisterwerk, Mods und Tuning",
          "Was es kosten würde, den Build zum Meisterwerk zu machen",
          "Fähigkeiten-Cooldowns und Schadensresistenz bei diesen Werten",
        ],
      },
    ],
    tryIt: "Klick die App an und probier sie selbst aus.",
    tryItHint: "Eine Demo mit Beispieldaten (auf Englisch) – manche Funktionen gehen nur in der echten App.",
    swipe: "Clips aus der echten App",
    demo: "Radar-Demo",
    clickToTry: "Klicken und selbst ausprobieren",
    backToTour: "Zurück zur Tour",
  },
  game: {
    note: "Ein gezeichneter Spielbildschirm mit Beispiel-Ausrüstung; der Hinweis und die Seite darüber sind das echte Radar · Destiny 2 läuft hier nicht",
    hover: "Drüberfahren",
    inspect: "Ansehen",
    page: "Radar-Seite",
    close: "Schließen",
    tip: "Klick oder F10: Radars Seite dazu",
  },
  features: {
    kicker: "Außerdem",
    title: "Eine App statt fünf Tabs.",
    text: "Gebaut für Destiny 2 auf dem PC, gemacht, um nicht im Weg zu sein.",
    items: [
      {
        title: "Liest Hüter-Namen",
        text: "Öffne den Charakterbildschirm von jemandem, und Radar findet ihn – auch mit Unterstrichen, Klammern, Symbolen, kyrillischen und CJK-Namen.",
      },
      {
        title: "DIM und Discord über dem Spiel",
        text: "F6 öffnet deinen LFG-Discord, F7 öffnet DIM, direkt über Destiny. /join-Codes bekommen einen Button, der sie kopiert.",
      },
      {
        title: "Ein Overlay, das du selbst platzierst",
        text: "Uhr, Session-Werte und die Hinweise kommen dorthin, wo du sie haben willst. Klicks gehen direkt durch ins Spiel.",
      },
      {
        title: "Startet mit Destiny",
        text: "Radar wartet im Infobereich und kommt, wenn das Spiel startet. Alles ist geladen, bevor du im Orbit landest.",
      },
      {
        title: "Bremst dein Spiel nicht",
        text: "Radar braucht kaum etwas von deinem PC: Das Overlay zeichnet nur, wo seine Widgets sind, und alles, was du gerade nicht nutzt, pausiert.",
      },
      {
        title: "In deiner Farbe",
        text: "Wähl eine Subklassen-Farbe oder eine eigene – App und Overlay ziehen mit.",
      },
      {
        title: "Makros",
        text: "Bau Abläufe aus Fähigkeiten, Tasten, Maustasten und Pausen und leg sie auf einen Hotkey oder Maus 4/5 – einmal, gehalten oder zum Umschalten. Sie nutzen deine Tastenbelegung aus dem Spiel.",
      },
      {
        title: "Ingame-Tasten neu belegen",
        text: "Ändere Destinys Tastenbelegung direkt in Radar, mit Suche über alle Aktionen. Auf Wunsch schreibgeschützt, damit das Spiel nichts zurücksetzt.",
      },
    ],
  },
  safety: {
    kicker: "Sicherheit",
    title: "Neben dem Spiel, nicht darin.",
    text: "Radar sitzt neben Destiny 2, nicht darin. Es schaut auf den Bildschirm, fragt Bungie und drückt für Makros Tasten, wie du auf deiner Tastatur.",
    items: [
      "Liest oder ändert nie den Speicher des Spiels. Die Tastenbelegung ändert es nur, wenn du das in Radar machst.",
      "Liest nur, was auf deinem Bildschirm ist, wie ein Screenshot",
      "Deine Daten kommen von Bungies offizieller API, wie bei DIM",
      "Dein Bungie-Login bleibt auf deinem PC",
      "Open Source: der komplette Code ist öffentlich auf GitHub",
    ],
  },
  how: {
    kicker: "So geht's",
    title: "In wenigen Minuten startklar.",
    steps: [
      { title: "Herunterladen", text: "Hol dir den Installer ({size}). Keine Admin-Rechte nötig." },
      { title: "Bungie verbinden", text: "Einmal mit deinem Bungie-Konto anmelden – keine Keys, nichts einzurichten." },
      {
        title: "Destiny 2 starten",
        text: "Radar startet mit dem Spiel im randlosen Modus. F10 öffnet, was du ansiehst, F6 Discord, F7 DIM.",
      },
    ],
  },
  faq: {
    kicker: "FAQ",
    title: "Fragen und Antworten.",
    items: [
      {
        q: "Kann ich für Radar gebannt werden?",
        a: "Radar steckt keinen Code ins Spiel und liest nicht seinen Speicher. Es liest, was auf deinem Bildschirm ist (wie ein Screenshot), und spricht mit Bungies offizieller API, genau wie DIM. Makros drücken Tasten so, als würdest du sie selbst drücken.",
      },
      { q: "Ist es kostenlos?", a: "Ja. Radar ist kostenlos herunterzuladen und zu benutzen." },

      { q: "Ist Radar Open Source?", a: "Ja. Der komplette Quellcode von Radar ist öffentlich auf GitHub – github.com/Niklas2654/D2Radar – unter der Lizenz GPL-3.0. Der Code jeder veröffentlichten Version steht dort." },
      {
        q: "Wofür ist der Bungie-Login?",
        a: "Du meldest dich auf Bungies eigener Seite an – Radar sieht dein Passwort nie. Damit kann Radar deinen Tresor und dein Inventar lesen und deine Ausrüstung verschieben oder anlegen. Der Login bleibt auf deinem PC.",
      },
      {
        q: "Kostet das Overlay FPS?",
        a: "Ein wenig, wie jedes Fenster über einem Spiel. Radar hält es so klein wie möglich: Das Overlay deckt nur den Teil des Bildschirms ab, in dem seine Widgets sind, liest den Bildschirm nur, wenn sich etwas geändert hat, und schickt DIM und Discord schlafen, solange sie versteckt sind. Du kannst das Overlay ausschalten und alles andere behalten.",
      },
      {
        q: "Funktioniert es mit jedem Hüter-Namen?",
        a: "Radar liest Namen mit einer eigenen, eingebauten Erkennung – keine Sprachpakete nötig. Symbole, kyrillische und CJK-Namen inklusive. Ist ein Name zu ausgefallen, kannst du den Spieler immer noch von Hand suchen.",
      },
      {
        q: "Welche Sprachen spricht Radar?",
        a: "Deutsch, Englisch, Französisch, Spanisch, Italienisch, Portugiesisch (Brasilien), Polnisch und Russisch – jederzeit in den Einstellungen umstellbar. Items und Aktivitäten kommen von Bungie in derselben Sprache.",
      },
      { q: "Welche Plattformen?", a: "Windows 10 und 11, mit Destiny 2 auf Steam oder im Epic Games Store im randlosen Fenstermodus." },
      {
        q: "Ist Radar von Bungie?",
        a: "Nein. Radar ist eine Fan-App und weder mit Bungie verbunden noch von Bungie unterstützt. Destiny ist eine Marke von Bungie, Inc.",
      },
    ],
  },
  download: {
    title: "Bereit, wenn du es bist,",
    titleAccent: "Hüter.",
    text: "Radar herunterladen, Destiny 2 starten – und alles ist da, wenn du im Orbit landest.",
    button: "Download für Windows",
    version: "Version {version}",
    installer: "{size} Installer",
    windows: "Windows 10 / 11",
    free: "Kostenlos",


    openSource: "Open Source",
    downloads: "{n} Downloads",
    downloadsLive: "Live gezählt",
    active: "{n} aktive Guardians",
    activeLive: "Bungie-Konten, die Radar in den letzten 30 Tagen genutzt haben – live gezählt",
  },
  footer: {
    legal: "Impressum",
    privacy: "Datenschutz",

    source: "Quellcode",
    disclaimer: "Nicht mit Bungie verbunden. Destiny 2 ist eine Marke von Bungie, Inc.",
  },
};

export default de;
