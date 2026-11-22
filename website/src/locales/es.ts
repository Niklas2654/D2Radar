import type { Strings } from "../i18n";

const es: Strings = {
  nav: { tour: "Recorrido", features: "Funciones", safety: "Seguridad", faq: "FAQ", download: "Descargar", language: "Idioma" },
  hero: {
    badge: "Gratis para Windows · v{version}",
    title: "Mira lo que el juego",
    titleAccent: "no te dice.",
    text: "Todo sobre tu Guardián, justo al lado del juego. Radar reconoce el arma, la armadura o el Guardián que estás mirando y muestra lo que el juego no: cada roll, valores exactos, clears, lowmans y builds. Además, todas tus equipaciones en un solo lugar, y DIM y Discord a un atajo de distancia.",
    download: "Descargar para Windows",
    tour: "Ver el recorrido",
    meta: "{size} · Windows 10/11 · Sin afiliación con Bungie",
    inAction: "Velo en acción",
  },
  tour: {
    kicker: "El recorrido",
    title: "Recorre la app real.",
    text: "Capítulo a capítulo, de tu escuadra al overlay dentro del juego.",
    chapters: [
      {
        name: "Escuadra",
        title: "Sabe con quién juegas.",
        text: "Clears, lowmans, mejores tiempos y la build de cada Guardián: la tuya, las de tu escuadra y la de cualquiera que busques.",
      },
      {
        name: "Base de datos",
        title: "Cada arma y pieza de armadura, con números reales.",
        text: "Todos los rolls, las fuentes y los valores exactos de las ventajas, junto a las copias que tienes.",
      },
      {
        name: "Equipaciones",
        title: "Todas tus equipaciones en un solo lugar.",
        text: "Ranuras del juego, equipaciones de DIM y presets: equípalas, guárdalas y créalas sin salir de Radar.",
      },
      {
        name: "Optimizador de armadura",
        title: "La mejor armadura para las estadísticas que quieres.",
        text: "Marca tus objetivos y Radar busca en todo tu depósito las builds que los alcanzan.",
      },
      {
        name: "En el juego",
        title: "Justo encima del juego.",
        text: "Pasa el ratón por un arma o una pieza de armadura como en el juego: Radar la reconoce y muestra su aviso. Haz clic o pulsa F10 para ver la página de Radar. Abre también el artefacto.",
      },
    ],
    snippets: [
      {
        title: "Escáner de escuadra",
        subtitle: "Clears, rangos y mejores tiempos de todos con quienes juegas",
        points: [
          "Full clears de incursiones y mazmorras, contados desde los propios informes de Bungie",
          "La suma de tus mejores tiempos, por incursión y mazmorra",
          "Tu escuadra y los jugadores de tus últimas actividades, a un clic",
        ],
      },
      {
        title: "Cada lowman, etiquetado",
        subtitle: "Solo, dúo y trío sin fallos — con la clase con la que se hizo",
        points: [
          "Clears del primer día, en modo competición y de la primera semana marcados como tales",
          "Runs sin fallos, maestras y en solitario, con las proezas activas",
          "Los símbolos de clase muestran cada clase con la que se ganó una etiqueta",
        ],
      },
      {
        title: "Las runs detrás de una etiqueta",
        subtitle: "Un clic muestra la run — o una por clase",
        points: ["Bajas, muertes y tiempo de cada jugador", "Las armas que más usó cada uno", "Un enlace al informe completo en RaidHub"],
      },
      {
        title: "Cada roll de un vistazo",
        subtitle: "Todas las ventajas que puede tener un arma, y tus copias",
        points: [
          "Cada columna de ventajas, incluidas las mejoradas",
          "Tus copias marcadas en la lista",
          "Elige dos ventajas y saca la copia correspondiente de tu depósito",
        ],
      },
      {
        title: "Busca por dónde cae",
        subtitle: "source:vaultofglass lista todo lo que da una raid, mazmorra o planeta",
        points: ["Armas y armaduras en una sola búsqueda", "Nombres, nombres de sets de armadura y orígenes, con autocompletado", "Armaduras ordenadas por clase y ranura"],
      },
      {
        title: "Lo que usan los jugadores",
        subtitle: "Las armas y ventajas más usadas de las últimas 1.000 completadas",
        points: ["Incursiones, mazmorras o ambas juntas", "Las ventajas que la gente elige en cada arma, con su porcentaje", "Actualizado en segundo plano"],
      },
      {
        title: "Sets de armadura con valores exactos",
        subtitle: "Bonificaciones de conjunto con los valores reales, cada copia tuya",
        points: [
          "Bonificaciones de dos y cuatro piezas tal como funcionan de verdad",
          "Todas tus copias con sus estadísticas, depósito incluido",
          "Doble clic en una para sacarla del depósito",
        ],
      },
      {
        title: "Modificadores y ajuste",
        subtitle: "Cambia modificadores y mira tus estadísticas antes de equipar",
        points: [
          "Estadísticas exactas de cada modificador al pasar el ratón",
          "Solo los modificadores que realmente puedes insertar, ordenados por coste",
          "Tus estadísticas con esta pieza frente a lo que llevas",
        ],
      },
      {
        title: "Todas tus equipaciones",
        subtitle: "Ranuras del juego, equipaciones de DIM y presets lado a lado",
        points: ["Equipa cualquier equipación con un clic", "Guarda una equipación del juego en DIM con un nombre", "Presets que cambian varias equipaciones a la vez"],
      },
      {
        title: "La build de cualquier Guardián",
        subtitle: "Subclase, armas, armadura y estadísticas de quien busques",
        points: [
          "Cada personaje de un jugador",
          "Armas con sus ventajas, armadura con modificadores y bonificaciones de conjunto",
          "Busca a alguien por nombre, o directamente desde su pantalla de personaje en el juego",
        ],
      },
      {
        title: "Crea una equipación",
        subtitle: "Ranura a ranura: armas, armadura, subclase y artefacto",
        points: [
          "Empieza con lo que llevas puesto o desde cero",
          "Armas con las ventajas que elijas, aplicadas al equipar",
          "Guárdala y equípala después con un clic",
        ],
      },
      {
        title: "Armadura para las estadísticas que quieres",
        subtitle: "Fija los mínimos y Radar combina todo tu depósito",
        points: [
          "Muestra hasta dónde puede subir aún cada estadística",
          "Cuenta cada pieza de tus personajes y del depósito",
          "Obra maestra, modificadores y ajuste de nivel 5 incluidos",
        ],
      },
      {
        title: "Tu build, tus reglas",
        subtitle: "Excepcional, bonificaciones de conjunto y modificadores fijos: el resto se calcula a su alrededor",
        points: [
          "Elige un excepcional, o deja que Radar elija uno",
          "Pide una bonificación de conjunto: esas piezas entran en cada build",
          "Fija tú una pieza o un modificador, o descarta alguna",
        ],
      },
      {
        title: "Cada build, en detalle",
        subtitle: "Qué aporta cada pieza, cuánto cuesta y qué consigues",
        points: [
          "Estadísticas por pieza: roll, obra maestra, modificadores y ajuste",
          "Lo que costaría llevar la build a obra maestra",
          "Enfriamiento de habilidades y resistencia al daño con esas estadísticas",
        ],
      },
    ],
    tryIt: "Haz clic en la app para probarla tú mismo.",
    tryItHint: "Una demo con datos de ejemplo (en inglés) – algunas funciones solo van en la app real.",
    swipe: "Clips de la app real",
    demo: "Demo de Radar",
    clickToTry: "Haz clic para probarla",
    backToTour: "Volver al recorrido",
  },
  game: {
    note: "Una pantalla de juego dibujada con equipo de ejemplo; el aviso y la página sobre ella son el Radar real · Destiny 2 no se está ejecutando aquí",
    hover: "Pasar el ratón",
    inspect: "Inspeccionar",
    page: "Página de Radar",
    close: "Cerrar",
    tip: "Clic o F10: la página de Radar",
  },
  features: {
    kicker: "Y además",
    title: "Una app en lugar de cinco pestañas.",
    text: "Hecha para Destiny 2 en PC, pensada para no estorbar.",
    items: [
      {
        title: "Lee los nombres de los Guardianes",
        text: "Abre la pantalla de personaje de alguien y Radar lo encuentra — también con guiones bajos, corchetes, símbolos, nombres cirílicos y CJK.",
      },
      {
        title: "DIM y Discord sobre el juego",
        text: "F6 abre tu Discord de LFG, F7 abre DIM, justo encima de Destiny. Los códigos /join tienen un botón que los copia.",
      },
      {
        title: "Un overlay que colocas tú",
        text: "El reloj, las estadísticas de la sesión y los avisos van donde quieras. Los clics pasan directamente al juego.",
      },
      {
        title: "Se inicia con Destiny",
        text: "Radar espera en la bandeja del sistema y aparece cuando lo hace el juego. Todo está cargado antes de que llegues a la órbita.",
      },
      {
        title: "No ralentiza tu juego",
        text: "Radar apenas usa tu PC: el overlay solo dibuja donde están sus widgets, y lo que no usas se pausa.",
      },
      {
        title: "A tu color",
        text: "Elige el color de una subclase o uno propio: la app y el overlay lo siguen.",
      },
      {
        title: "Macros",
        text: "Crea secuencias de habilidades, teclas, botones del ratón y pausas y asígnalas a un atajo o a Ratón 4/5: una vez, mantenido o alterno. Usan las teclas que tienes en el juego.",
      },
      {
        title: "Reasigna las teclas del juego",
        text: "Cambia las teclas de Destiny directamente en Radar, con búsqueda en todas las acciones. Si quieres, protégelas contra escritura para que el juego no las restablezca.",
      },
    ],
  },
  safety: {
    kicker: "Seguridad",
    title: "Al lado del juego, no dentro.",
    text: "Radar está al lado de Destiny 2, no dentro. Mira la pantalla, pregunta a Bungie y, para las macros, pulsa teclas como lo harías tú en tu teclado.",
    items: [
      "Nunca lee ni cambia la memoria del juego. Solo cambia tus teclas cuando lo haces en Radar.",
      "Solo lee lo que hay en tu pantalla, como una captura",
      "Tus datos vienen de la API oficial de Bungie, como con DIM",
      "Tu inicio de sesión de Bungie se queda en tu PC",
      "Código abierto: todo el código es público en GitHub",
    ],
  },
  how: {
    kicker: "Cómo funciona",
    title: "Listo en pocos minutos.",
    steps: [
      { title: "Descargar", text: "Descarga el instalador ({size}). No hacen falta permisos de administrador." },
      { title: "Conectar Bungie", text: "Inicia sesión una vez con tu cuenta de Bungie – sin claves, nada que configurar." },
      {
        title: "Iniciar Destiny 2",
        text: "Radar aparece con el juego en modo sin bordes. F10 abre lo que miras, F6 Discord, F7 DIM.",
      },
    ],
  },
  faq: {
    kicker: "FAQ",
    title: "Preguntas y respuestas.",
    items: [
      {
        q: "¿Me pueden banear por usar Radar?",
        a: "Radar no mete código en el juego ni lee su memoria. Lee lo que hay en tu pantalla (como una captura) y habla con la API oficial de Bungie, igual que DIM. Las macros pulsan teclas como si las pulsaras tú.",
      },
      { q: "¿Es gratis?", a: "Sí. Radar es gratis de descargar y usar." },

      { q: "¿Radar es de código abierto?", a: "Sí. Todo el código fuente de Radar es público en GitHub – github.com/Niklas2654/D2Radar – bajo la licencia GPL-3.0. El código de cada versión publicada está allí." },
      {
        q: "¿Para qué sirve el inicio de sesión de Bungie?",
        a: "Inicias sesión en la propia página de Bungie – Radar nunca ve tu contraseña. Permite a Radar leer tu depósito e inventario y mover o equipar tu equipo. El inicio de sesión se queda en tu PC.",
      },
      {
        q: "¿El overlay cuesta FPS?",
        a: "Un poco, como cualquier ventana sobre un juego. Radar lo mantiene lo más pequeño posible: el overlay solo cubre la parte de la pantalla donde están sus widgets, solo lee la pantalla cuando algo cambió, y duerme DIM y Discord mientras están ocultos. Puedes desactivar el overlay y conservar todo lo demás.",
      },
      {
        q: "¿Funciona con cualquier nombre de Guardián?",
        a: "Radar lee los nombres con su propio reconocimiento integrado — sin paquetes de idioma que instalar. Símbolos, nombres cirílicos y CJK incluidos. Si un nombre es demasiado rebuscado, siempre puedes buscar al jugador a mano.",
      },
      {
        q: "¿Qué idiomas habla Radar?",
        a: "Español, inglés, alemán, francés, italiano, portugués (Brasil), polaco y ruso – cámbialo cuando quieras en los ajustes. Los objetos y actividades vienen de Bungie en el mismo idioma.",
      },
      { q: "¿Qué plataformas?", a: "Windows 10 y 11, con Destiny 2 en Steam o la Epic Games Store en modo ventana sin bordes." },
      {
        q: "¿Radar lo hace Bungie?",
        a: "No. Radar es una app complementaria hecha por fans, sin afiliación ni respaldo de Bungie. Destiny es una marca registrada de Bungie, Inc.",
      },
    ],
  },
  download: {
    title: "Listo cuando tú lo estés,",
    titleAccent: "Guardián.",
    text: "Descarga Radar, inicia Destiny 2 y todo estará ahí cuando llegues a la órbita.",
    button: "Descargar para Windows",
    version: "Versión {version}",
    installer: "Instalador de {size}",
    windows: "Windows 10 / 11",
    free: "Gratis",


    openSource: "Código abierto",
    downloads: "{n} descargas",
    downloadsLive: "Contado en directo",
    active: "{n} Guardianes activos",
    activeLive: "Cuentas de Bungie que usaron Radar en los últimos 30 días – contado en directo",
  },
  footer: {
    legal: "Aviso legal",
    privacy: "Privacidad",

    source: "Código fuente",
    disclaimer: "Sin afiliación con Bungie. Destiny 2 es una marca registrada de Bungie, Inc.",
  },
};

export default es;
