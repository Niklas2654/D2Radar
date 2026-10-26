import type { Strings } from "../i18n";

const pt: Strings = {
  nav: { tour: "Tour", features: "Recursos", safety: "Segurança", faq: "FAQ", download: "Baixar", language: "Idioma" },
  hero: {
    badge: "Grátis para Windows · v{version}",
    title: "Veja o que o jogo",
    titleAccent: "não te conta.",
    text: "Tudo sobre o seu Guardião, bem ao lado do jogo. O Radar reconhece a arma, a armadura ou o Guardião que você está olhando e mostra o que o jogo não mostra: cada roll, valores exatos, clears, lowmans e builds. E ainda todos os seus sets em um só lugar, e DIM e Discord a um atalho de distância.",
    download: "Baixar para Windows",
    features: "Ver todos os recursos",
    meta: "{size} · Windows 10/11 · Sem afiliação com a Bungie",
    inAction: "Veja em ação",
  },
  tour: {
    snippets: [
      {
        title: "Scanner de esquadra",
        subtitle: "Clears, ranks e melhores tempos de todos com quem você joga",
        points: [
          "Full clears de incursões e masmorras, contados a partir dos relatórios da própria Bungie",
          "A soma dos seus melhores tempos, por incursão e masmorra",
          "Sua esquadra e os jogadores das suas últimas atividades, a um clique",
        ],
      },
      {
        title: "Todo lowman, marcado",
        subtitle: "Solo, duo e trio sem falhas — com a classe usada",
        points: [
          "Clears do primeiro dia, no modo competição e da primeira semana marcados como tal",
          "Runs sem falhas, mestre e solo, com as façanhas ativas",
          "Os símbolos de classe mostram cada classe em que uma marca foi conquistada",
        ],
      },
      {
        title: "As runs por trás de uma marca",
        subtitle: "Um clique mostra a run — ou uma por classe",
        points: ["Abates, mortes e tempo de cada jogador", "As armas que cada um mais usou", "Um link para o relatório completo no RaidHub"],
      },
      {
        title: "Todo roll num relance",
        subtitle: "Todos os perks que uma arma pode ter, e as suas cópias",
        points: [
          "Cada coluna de perks, incluindo os melhorados",
          "Suas cópias marcadas na lista",
          "Escolha dois perks e tire a cópia correspondente do cofre",
        ],
      },
      {
        title: "Busque pela origem",
        subtitle: "source:vaultofglass lista tudo o que uma raid, masmorra ou planeta dropa",
        points: ["Armas e armaduras numa só busca", "Nomes, nomes de conjuntos de armadura e origens, com preenchimento automático", "Armaduras ordenadas por classe e espaço"],
      },
      {
        title: "O que os jogadores usam",
        subtitle: "As armas e perks mais usados das últimas 1.000 conclusões",
        points: ["Incursões, masmorras ou as duas juntas", "Os perks que o pessoal escolhe em cada arma, com a porcentagem", "Mantido atualizado em segundo plano"],
      },
      {
        title: "Conjuntos de armadura com valores exatos",
        subtitle: "Bônus de conjunto com os valores reais, cada cópia sua",
        points: [
          "Bônus de duas e quatro peças como realmente funcionam",
          "Todas as suas cópias com os atributos, cofre incluído",
          "Clique duplo numa para tirá-la do cofre",
        ],
      },
      {
        title: "Mods e ajuste",
        subtitle: "Troque mods e veja seus atributos antes de equipar",
        points: [
          "Atributos exatos de cada mod ao passar o mouse",
          "Só os mods que você realmente pode inserir, ordenados por custo",
          "Seus atributos com esta peça comparados ao que você usa",
        ],
      },
      {
        title: "Todos os seus sets",
        subtitle: "Espaços do jogo, sets do DIM e presets lado a lado",
        points: ["Equipe qualquer set com um clique", "Salve um set do jogo no DIM com um nome", "Presets que trocam vários sets de uma vez"],
      },
      {
        title: "A build de qualquer Guardião",
        subtitle: "Subclasse, armas, armadura e atributos de quem você procurar",
        points: [
          "Cada personagem de um jogador",
          "Armas com seus perks, armadura com mods e bônus de conjunto",
          "Procure alguém pelo nome, ou direto da tela de personagem no jogo",
        ],
      },
    ],
    tryIt: "Clique no app para experimentar você mesmo.",
    tryItHint: "Uma demo com dados de exemplo (em inglês) – alguns recursos só funcionam no app de verdade. Role sobre ela ou use as setas para ver mais.",
    swipe: "Deslize, arraste ou use as setas · clipes do app de verdade",
    pictures: "Imagens do app",
    previous: "Anterior",
    next: "Próximo",
    demo: "Demo do Radar",
    clickToTry: "Clique para experimentar",
    backToTour: "Voltar ao tour",
  },
  features: {
    kicker: "Recursos",
    title: "Um app no lugar de cinco abas.",
    text: "Feito para Destiny 2 no PC, pensado para não atrapalhar.",
    items: [
      {
        title: "Reconhece o que você olha",
        text: "Inspecione uma arma ou peça de armadura e um aviso aparece sobre o jogo. F10 abre a página completa dela.",
      },
      {
        title: "Lê nomes de Guardiões",
        text: "Abra a tela de personagem de alguém e o Radar o encontra — também com sublinhados, colchetes, símbolos, nomes cirílicos e CJK.",
      },
      {
        title: "Perks do artefato, exatos",
        text: "Na tela do artefato, o Radar lista cada perk do artefato da temporada com o que ele realmente faz.",
      },
      {
        title: "Todos os seus sets em um lugar",
        text: "Equipe sets do jogo e do DIM com um clique, salve novos no DIM, ou troque um preset inteiro de uma vez.",
      },
      {
        title: "DIM e Discord sobre o jogo",
        text: "F6 abre seu Discord de LFG, F7 abre o DIM, bem em cima do Destiny. Os códigos /join ganham um botão que os copia.",
      },
      {
        title: "Um overlay que você posiciona",
        text: "Relógio, estatísticas da sessão e avisos ficam onde você quiser. Os cliques passam direto para o jogo.",
      },
      {
        title: "Inicia com o Destiny",
        text: "O Radar espera na bandeja do sistema e aparece quando o jogo abre. Tudo está carregado antes de você chegar à órbita.",
      },
      {
        title: "Não deixa seu jogo lento",
        text: "O Radar quase não usa seu PC: o overlay só desenha onde estão seus widgets, e o que você não está usando fica em pausa.",
      },
    ],
  },
  safety: {
    kicker: "Segurança",
    title: "Sem mexer no jogo.",
    text: "O Radar fica ao lado do Destiny 2, não dentro dele. Ele olha a tela e pergunta à Bungie — nada mais.",
    items: [
      "Nunca envia uma tecla ou clique ao Destiny 2",
      "Não lê nem altera a memória ou os arquivos do jogo",
      "Lê só o que está na sua tela, como uma captura",
      "Seus dados vêm da API oficial da Bungie, como no DIM",
      "Seu login da Bungie fica no seu PC",
      "Código aberto: todo o código é público no GitHub",
    ],
  },
  how: {
    kicker: "Como funciona",
    title: "Pronto em poucos minutos.",
    steps: [
      { title: "Baixar", text: "Baixe o instalador ({size}). Não precisa de permissão de administrador." },
      { title: "Conectar a Bungie", text: "Entre uma vez com sua conta Bungie – sem chaves, nada para configurar." },
      {
        title: "Abrir o Destiny 2",
        text: "O Radar aparece com o jogo no modo sem bordas. F10 abre o que você está olhando, F6 o Discord, F7 o DIM.",
      },
    ],
  },
  faq: {
    kicker: "FAQ",
    title: "Perguntas e respostas.",
    items: [
      {
        q: "Posso ser banido por usar o Radar?",
        a: "O Radar não injeta nada, não lê a memória do jogo e nunca envia comandos ao Destiny 2. Ele lê o que está na sua tela (como uma captura) e conversa com a API oficial da Bungie — do mesmo jeito que o DIM e outros apps companheiros.",
      },
      { q: "É grátis?", a: "Sim. O Radar é grátis para baixar e usar." },
      { q: "O Radar é de código aberto?", a: "Sim. Todo o código-fonte do Radar é público no GitHub – github.com/Niklas2654/D2Radar – sob a licença GPL-3.0. O código de cada versão publicada está lá." },
      {
        q: "Para que serve o login da Bungie?",
        a: "Você entra na própria página da Bungie – o Radar nunca vê sua senha. Ele permite que o Radar leia seu cofre e inventário e mova ou equipe seus itens. O login fica no seu PC.",
      },
      {
        q: "O overlay custa FPS?",
        a: "Um pouco, como qualquer janela sobre um jogo. O Radar o mantém o menor possível: o overlay só cobre a parte da tela onde estão seus widgets, só lê a tela quando algo mudou e põe o DIM e o Discord para dormir enquanto estão ocultos. Você pode desligar o overlay e manter todo o resto.",
      },
      {
        q: "Funciona com qualquer nome de Guardião?",
        a: "O Radar lê nomes com seu próprio reconhecimento embutido — sem pacotes de idioma para instalar. Símbolos, nomes cirílicos e CJK incluídos. Se um nome for elaborado demais, você ainda pode procurar o jogador manualmente.",
      },
      {
        q: "Quais idiomas o Radar fala?",
        a: "Português (Brasil), inglês, alemão, francês, espanhol, italiano, polonês e russo – mude quando quiser nas configurações. Itens e atividades vêm da Bungie no mesmo idioma.",
      },
      { q: "Quais plataformas?", a: "Windows 10 e 11, com Destiny 2 na Steam ou na Epic Games Store em modo janela sem bordas." },
      {
        q: "O Radar é feito pela Bungie?",
        a: "Não. O Radar é um app companheiro feito por fãs, sem afiliação nem endosso da Bungie. Destiny é uma marca registrada da Bungie, Inc.",
      },
    ],
  },
  download: {
    title: "Pronto quando você estiver,",
    titleAccent: "Guardião.",
    text: "Baixe o Radar, abra o Destiny 2 e tudo estará lá quando você chegar à órbita.",
    button: "Baixar para Windows",
    version: "Versão {version}",
    installer: "Instalador de {size}",
    windows: "Windows 10 / 11",
    free: "Grátis",
    openSource: "Código aberto",
    downloads: "{n} downloads",
    downloadsLive: "Contado ao vivo",
    active: "{n} Guardiões ativos",
    activeLive: "Contas Bungie que usaram o Radar nos últimos 30 dias – contado ao vivo",
  },
  footer: {
    legal: "Aviso legal",
    privacy: "Privacidade",
    source: "Código-fonte",
    disclaimer: "Sem afiliação com a Bungie. Destiny 2 é uma marca registrada da Bungie, Inc.",
  },
};

export default pt;
