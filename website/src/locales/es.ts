import type { Strings } from "../i18n";

const es: Strings = {
  nav: { tour: "Recorrido", features: "Funciones", safety: "Seguridad", faq: "FAQ", download: "Descargar", language: "Idioma" },
  hero: {
    badge: "Gratis para Windows · v{version}",
    title: "Mira lo que el juego",
    titleAccent: "no te dice.",
    text: "Todo sobre tu Guardián, justo al lado del juego. Radar reconoce el arma, la armadura o el Guardián que estás mirando y muestra lo que el juego no: cada roll, valores exactos, clears, lowmans y builds. Además, equipaciones, DIM y Discord a un atajo de distancia.",
    download: "Descargar para Windows",
    features: "Ver todas las funciones",
    meta: "{size} · Windows 10/11 · Sin afiliación con Bungie",
    inAction: "Velo en acción",
  },
  tour: {
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
        points: ["Equipa una equipación con un atajo, en el juego", "Guarda una equipación del juego en DIM con un nombre", "Presets que cambian varias equipaciones a la vez"],
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
    ],
    tryIt: "Haz clic en la app para probarla tú mismo.",
    tryItHint: "Una demo con datos de ejemplo (en inglés) – algunas funciones solo van en la app real. Desplázate sobre ella o usa las flechas para ver más.",
    swipe: "Desliza, arrastra o usa las flechas · clips de la app real",
    pictures: "Imágenes de la app",
    previous: "Anterior",
    next: "Siguiente",
    demo: "Demo de Radar",
    clickToTry: "Haz clic para probarla",
    backToTour: "Volver al recorrido",
  },
  features: {
    kicker: "Funciones",
    title: "Una app en lugar de cinco pestañas.",
    text: "Hecha para Destiny 2 en PC, pensada para no estorbar.",
    items: [
      {
        title: "Reconoce lo que miras",
        text: "Inspecciona un arma o una pieza de armadura y aparece un aviso sobre el juego. F10 abre su página completa.",
      },
      {
        title: "Lee los nombres de los Guardianes",
        text: "Abre la pantalla de personaje de alguien y Radar lo encuentra — también con guiones bajos, corchetes, símbolos, nombres cirílicos y CJK.",
      },
      {
        title: "Ventajas del artefacto, exactas",
        text: "En la pantalla del artefacto, Radar lista cada ventaja del artefacto de la temporada con lo que hace de verdad.",
      },
      {
        title: "Equipaciones con un atajo",
        text: "Equipa equipaciones del juego y de DIM sin salir de la partida, o cambia un preset entero de una vez.",
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
    ],
  },
  safety: {
    kicker: "Seguridad",
    title: "Sin tocar el juego.",
    text: "Radar está al lado de Destiny 2, no dentro. Mira la pantalla y pregunta a Bungie — nada más.",
    items: [
      "Nunca envía una pulsación ni un clic a Destiny 2",
      "No lee ni cambia la memoria ni los archivos del juego",
      "Solo lee lo que hay en tu pantalla, como una captura",
      "Tus datos vienen de la API oficial de Bungie, como con DIM",
      "Tu inicio de sesión de Bungie se queda en tu PC",
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
        a: "Radar no inyecta nada, no lee la memoria del juego y nunca envía entradas a Destiny 2. Lee lo que hay en tu pantalla (como una captura) y habla con la API oficial de Bungie — igual que DIM y otras apps complementarias.",
      },
      { q: "¿Es gratis?", a: "Sí. Radar es gratis de descargar y usar." },
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
  },
  footer: {
    legal: "Aviso legal",
    privacy: "Privacidad",
    disclaimer: "Sin afiliación con Bungie. Destiny 2 es una marca registrada de Bungie, Inc.",
  },
};

export default es;
