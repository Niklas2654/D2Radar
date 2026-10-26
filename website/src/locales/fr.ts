import type { Strings } from "../i18n";

const fr: Strings = {
  nav: { tour: "Visite", features: "Fonctions", safety: "Sécurité", faq: "FAQ", download: "Télécharger", language: "Langue" },
  hero: {
    badge: "Gratuit pour Windows · v{version}",
    title: "Vois ce que le jeu",
    titleAccent: "ne te dit pas.",
    text: "Tout sur ton Gardien, juste à côté du jeu. Radar reconnaît l'arme, l'armure ou le Gardien que tu regardes et affiche ce que le jeu cache : chaque roll, des valeurs exactes, clears, lowmans et builds. Et en plus tous tes équipements au même endroit, DIM et Discord à un raccourci près.",
    download: "Télécharger pour Windows",
    features: "Voir toutes les fonctions",
    meta: "{size} · Windows 10/11 · Non affilié à Bungie",
    inAction: "Le voir en action",
  },
  tour: {
    snippets: [
      {
        title: "Scanner d'escouade",
        subtitle: "Clears, rangs et meilleurs temps de tous ceux avec qui tu joues",
        points: [
          "Full clears de raids et de donjons, comptés d'après les rapports de Bungie",
          "La somme de tes meilleurs temps, par raid et par donjon",
          "Ton escouade et les joueurs de tes dernières activités, à un clic",
        ],
      },
      {
        title: "Chaque lowman, marqué",
        subtitle: "Solo, duo et trio sans faute — avec la classe utilisée",
        points: [
          "Clears du premier jour, en mode compétition et de la première semaine marqués comme tels",
          "Runs sans faute, maître et solo, avec les exploits activés",
          "Les symboles de classe montrent chaque classe avec laquelle un tag a été obtenu",
        ],
      },
      {
        title: "Les runs derrière un tag",
        subtitle: "Un clic affiche le run — ou un par classe",
        points: ["Éliminations, morts et temps de chaque joueur", "Les armes que chacun a le plus utilisées", "Un lien vers le rapport complet sur RaidHub"],
      },
      {
        title: "Chaque roll d'un coup d'œil",
        subtitle: "Tous les attributs qu'une arme peut avoir, et tes exemplaires",
        points: [
          "Chaque colonne d'attributs, attributs améliorés compris",
          "Tes exemplaires marqués dans la liste",
          "Choisis deux attributs et sors l'exemplaire correspondant de ton coffre",
        ],
      },
      {
        title: "Recherche par provenance",
        subtitle: "source:vaultofglass liste tout ce que donne un raid, un donjon ou une planète",
        points: ["Armes et armures en une seule recherche", "Noms, noms de sets d'armure et sources, avec autocomplétion", "Armures triées par classe et emplacement"],
      },
      {
        title: "Ce que les joueurs utilisent",
        subtitle: "Les armes et attributs les plus utilisés des 1 000 dernières complétions",
        points: ["Raids, donjons, ou les deux ensemble", "Les attributs choisis sur chaque arme, avec leur part", "Tenu à jour en arrière-plan"],
      },
      {
        title: "Sets d'armure avec valeurs exactes",
        subtitle: "Bonus d'ensemble avec les vraies valeurs, chacun de tes exemplaires",
        points: [
          "Bonus à deux et quatre pièces tels qu'ils fonctionnent vraiment",
          "Tous tes exemplaires avec leurs stats, coffre compris",
          "Double-clic pour en sortir un du coffre",
        ],
      },
      {
        title: "Mods et ajustements",
        subtitle: "Change de mods et vois tes stats avant d'équiper",
        points: [
          "Stats exactes de chaque mod au survol",
          "Seulement les mods que tu peux vraiment insérer, triés par coût",
          "Tes stats avec cette pièce comparées à ce que tu portes",
        ],
      },
      {
        title: "Tous tes équipements",
        subtitle: "Emplacements en jeu, équipements DIM et presets côte à côte",
        points: ["Équipe n'importe quel équipement en un clic", "Enregistre un équipement du jeu dans DIM avec un nom", "Des presets qui changent plusieurs équipements d'un coup"],
      },
      {
        title: "Le build de n'importe quel Gardien",
        subtitle: "Doctrine, armes, armure et stats de quiconque tu recherches",
        points: [
          "Chaque personnage d'un joueur",
          "Armes avec leurs attributs, armure avec mods et bonus d'ensemble",
          "Recherche quelqu'un par son nom, ou directement depuis son écran de personnage en jeu",
        ],
      },
    ],
    tryIt: "Clique sur l'application pour l'essayer toi-même.",
    tryItHint: "Une démo avec des données d'exemple (en anglais) – certaines fonctions ne marchent que dans la vraie application. Fais défiler ou utilise les flèches pour en voir plus.",
    swipe: "Glisse, fais défiler ou utilise les flèches · extraits de la vraie application",
    pictures: "Images de l'application",
    previous: "Précédent",
    next: "Suivant",
    demo: "Démo de Radar",
    clickToTry: "Clique pour l'essayer toi-même",
    backToTour: "Retour à la visite",
  },
  features: {
    kicker: "Fonctions",
    title: "Une appli au lieu de cinq onglets.",
    text: "Conçu pour Destiny 2 sur PC, fait pour ne pas te gêner.",
    items: [
      {
        title: "Reconnaît ce que tu regardes",
        text: "Inspecte une arme ou une pièce d'armure et une notification apparaît par-dessus le jeu. F10 ouvre sa page complète.",
      },
      {
        title: "Lit les noms des Gardiens",
        text: "Ouvre l'écran de personnage de quelqu'un et Radar le trouve — tirets bas, crochets, symboles, noms cyrilliques et CJK compris.",
      },
      {
        title: "Attributs d'artefact, exacts",
        text: "Sur l'écran de l'artefact, Radar liste chaque attribut de l'artefact de la saison avec ce qu'il fait vraiment.",
      },
      {
        title: "Tous tes équipements au même endroit",
        text: "Équipe les équipements du jeu et de DIM en un clic, enregistre-en de nouveaux dans DIM, ou change tout un preset d'un coup.",
      },
      {
        title: "DIM et Discord par-dessus le jeu",
        text: "F6 ouvre ton Discord LFG, F7 ouvre DIM, directement par-dessus Destiny. Les codes /join ont un bouton qui les copie.",
      },
      {
        title: "Un overlay que tu places toi-même",
        text: "Horloge, stats de session et notifications vont où tu veux. Les clics passent directement au jeu.",
      },
      {
        title: "Démarre avec Destiny",
        text: "Radar attend dans la zone de notification et apparaît avec le jeu. Tout est chargé avant que tu arrives en orbite.",
      },
      {
        title: "Ne ralentit pas ton jeu",
        text: "Radar sollicite à peine ton PC : l'overlay ne dessine que là où sont ses widgets, et tout ce que tu n'utilises pas se met en pause.",
      },
    ],
  },
  safety: {
    kicker: "Sécurité",
    title: "Pas touche au jeu.",
    text: "Radar se place à côté de Destiny 2, pas dedans. Il regarde l'écran et interroge Bungie — rien d'autre.",
    items: [
      "N'envoie jamais une touche ou un clic à Destiny 2",
      "Ne lit ni ne modifie la mémoire ou les fichiers du jeu",
      "Lit seulement ce qui est à l'écran, comme une capture",
      "Tes données viennent de l'API officielle de Bungie, comme avec DIM",
      "Ta connexion Bungie reste sur ton PC",
      "Open source : tout le code est public sur GitHub",
    ],
  },
  how: {
    kicker: "Comment ça marche",
    title: "Prêt en quelques minutes.",
    steps: [
      { title: "Télécharger", text: "Récupère l'installateur ({size}). Aucun droit administrateur nécessaire." },
      { title: "Connecter Bungie", text: "Connecte-toi une fois avec ton compte Bungie – pas de clés, rien à configurer." },
      {
        title: "Lancer Destiny 2",
        text: "Radar démarre avec le jeu en mode sans bordure. F10 ouvre ce que tu regardes, F6 Discord, F7 DIM.",
      },
    ],
  },
  faq: {
    kicker: "FAQ",
    title: "Questions et réponses.",
    items: [
      {
        q: "Puis-je être banni pour utiliser Radar ?",
        a: "Radar n'injecte rien, ne lit pas la mémoire du jeu et n'envoie jamais d'entrée à Destiny 2. Il lit ce qui est à l'écran (comme une capture) et utilise l'API officielle de Bungie — comme DIM et les autres applications compagnons.",
      },
      { q: "C'est gratuit ?", a: "Oui. Radar est gratuit à télécharger et à utiliser." },
      { q: "Radar est-il open source ?", a: "Oui. Tout le code source de Radar est public sur GitHub – github.com/Niklas2654/D2Radar – sous licence GPL-3.0. Le code de chaque version publiée y est publié." },
      {
        q: "À quoi sert la connexion Bungie ?",
        a: "Tu te connectes sur la page de Bungie – Radar ne voit jamais ton mot de passe. Elle permet à Radar de lire ton coffre et ton inventaire et de déplacer ou équiper ton équipement. La connexion reste sur ton PC.",
      },
      {
        q: "L'overlay coûte-t-il des FPS ?",
        a: "Un peu, comme toute fenêtre par-dessus un jeu. Radar le garde aussi léger que possible : l'overlay ne couvre que la partie de l'écran où sont ses widgets, ne lit l'écran que quand quelque chose a changé, et met DIM et Discord en veille quand ils sont cachés. Tu peux désactiver l'overlay et garder tout le reste.",
      },
      {
        q: "Ça marche avec n'importe quel nom de Gardien ?",
        a: "Radar lit les noms avec sa propre reconnaissance intégrée — aucun pack de langue à installer. Symboles, noms cyrilliques et CJK compris. Si un nom est trop fantaisiste, tu peux toujours chercher le joueur à la main.",
      },
      {
        q: "Quelles langues Radar parle-t-il ?",
        a: "Français, anglais, allemand, espagnol, italien, portugais (Brésil), polonais et russe – modifiable à tout moment dans les paramètres. Les objets et activités viennent de Bungie dans la même langue.",
      },
      { q: "Quelles plateformes ?", a: "Windows 10 et 11, avec Destiny 2 sur Steam ou l'Epic Games Store en mode fenêtré sans bordure." },
      {
        q: "Radar est-il fait par Bungie ?",
        a: "Non. Radar est une application compagnon créée par des fans, ni affiliée ni approuvée par Bungie. Destiny est une marque de Bungie, Inc.",
      },
    ],
  },
  download: {
    title: "Prêt quand tu l'es,",
    titleAccent: "Gardien.",
    text: "Télécharge Radar, lance Destiny 2, et tout est là quand tu arrives en orbite.",
    button: "Télécharger pour Windows",
    version: "Version {version}",
    installer: "Installateur de {size}",
    windows: "Windows 10 / 11",
    free: "Gratuit",
    openSource: "Open source",
    downloads: "{n} téléchargements",
    downloadsLive: "Compté en direct",
    active: "{n} Gardiens actifs",
    activeLive: "Comptes Bungie ayant utilisé Radar ces 30 derniers jours – compté en direct",
  },
  footer: {
    legal: "Mentions légales",
    privacy: "Confidentialité",
    source: "Code source",
    disclaimer: "Non affilié à Bungie. Destiny 2 est une marque de Bungie, Inc.",
  },
};

export default fr;
