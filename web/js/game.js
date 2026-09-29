// Máquina de estados da partida — A Guerra do Yom Kippur
(function (G) {
  G.YK = G.YK || {};
  const YK = G.YK;

  // gerador pseudoaleatório com semente (mulberry32) p/ partidas reproduzíveis.
  // O estado interno fica acessível em `.estado.a` para permitir clonar o jogo
  // (necessário ao MCTS, que simula ramos a partir de uma cópia do estado).
  function rngSemente(seed) {
    const est = { a: seed >>> 0 };
    const f = function () {
      est.a |= 0; est.a = (est.a + 0x6D2B79F5) | 0;
      let t = Math.imul(est.a ^ (est.a >>> 15), 1 | est.a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.estado = est;
    return f;
  }

  // clone profundo do estado, suficiente para simulação (MCTS). Religa as
  // referências de unidades dentro de `combats` por id; restaura o estado do RNG.
  function clonarEstado(state) {
    const units = state.units.map(u => ({ ...u }));
    const porId = new Map(units.map(u => [u.id, u]));
    const relig = arr => (arr || []).map(u => porId.get(u.id)).filter(Boolean);
    const combats = (state.combats || []).map(cb => ({
      atacantes: relig(cb.atacantes), defensores: relig(cb.defensores),
      barragem: relig(cb.barragem), cobertura: relig(cb.cobertura),
    }));
    const rng = rngSemente(0);
    rng.estado.a = state.rng.estado.a;
    return {
      seed: state.seed, rng, round: state.round, fase: state.fase,
      units, combats,
      ponteRodada: state.ponteRodada,
      entradasFase: { ...state.entradasFase },
      log: [],                       // o clone de simulação não acumula diário
      fim: state.fim ? { ...state.fim } : null,
      modos: state.modos,
      _sim: true,                    // marca: estado de simulação (silencia logs)
    };
  }

  const FASES = [
    { side: 'ISR', kind: 'mov',     titulo: 'Fase 1 — Movimentação israelense' },
    { side: 'ISR', kind: 'ataque',  titulo: 'Fase 2 — Designação de ataques israelenses' },
    { side: 'EGY', kind: 'cobertura', titulo: 'Fase 3 — Cobertura defensiva egípcia' },
    { side: 'ISR', kind: 'resolve', titulo: 'Fase 4 — Resolução dos combates' },
    { side: 'EGY', kind: 'mov',     titulo: 'Fase 5 — Movimentação egípcia' },
    { side: 'EGY', kind: 'ataque',  titulo: 'Fase 6 — Designação de ataques egípcios' },
    { side: 'ISR', kind: 'cobertura', titulo: 'Fase 7 — Cobertura defensiva israelense' },
    { side: 'EGY', kind: 'resolve', titulo: 'Fase 8 — Resolução dos combates' },
  ];

  const ENTRADAS = { ISR: ['2505', '1922'], EGY: ['1201', '0621', '0722'] };

  function novoJogo(opts) {
    const seed = (opts && opts.seed) || (Date.now() & 0x7fffffff);
    const state = {
      seed,
      rng: rngSemente(seed),
      round: 1,
      fase: 0,
      units: YK.criarUnidades(),
      log: [],
      combats: [],
      fim: null,
      modos: (opts && opts.modos) || { ISR: 'humano', EGY: 'ia' },
      ponteRodada: null,   // rodada em que a ponte de engenharia foi instalada
      entradasFase: {},    // contagem de entradas por casa nesta fase (pedágio em fila)
    };
    YK.log(state, `Nova partida. Semente ${seed}. ` +
      `ISR: ${state.modos.ISR}, EGY: ${state.modos.EGY}.`);
    return state;
  }

  function faseAtual(state) { return FASES[state.fase]; }

  // unidades fora do tabuleiro que podem entrar agora
  function poolEntrada(state, side) {
    return state.units.filter(u => {
      if (u.dead || u.hex || u.side !== side) return false;
      if (u.entrada === 99) { // reforço israelense: aguarda a ponte
        return state.ponteRodada !== null && state.round > state.ponteRodada &&
               YK.pontesEng(state) !== null; // 6.2: ponte precisa estar ativa
      }
      return state.round >= u.entrada;
    });
  }

  // casas de entrada válidas para uma unidade
  function casasEntrada(state, u) {
    let casas = ENTRADAS[u.side].slice();
    if (u.side === 'ISR') {
      if (u.tipo === 'eng' || u.entrada === 99 || u.retornando) casas = ['2505']; // 5.4 / 6.4
    }
    const zoc = YK.zocInimiga(state, u.side);
    return casas.filter(h => {
      const occ = YK.unidadeEm(state, h);
      if (occ && !(u.side === 'ISR' && occ.tipo === 'sam')) return false; // 6.8
      return true; // em ZOC pode entrar, mas para na 1ª casa (6.10)
    });
  }

  // entra com a unidade pela casa `h`; devolve {ok, im} (IM restante p/ continuar movendo)
  function entrarUnidade(state, u, h) {
    const casas = casasEntrada(state, u);
    if (!casas.includes(h)) return { ok: false };
    const n = (state.entradasFase[h] || 0) + 1; // pedágio em fila: 1º paga 1, 2º paga 2... (2.2.12)
    const im = YK.imAtual(u) - n;
    if (im < 0) return { ok: false };
    state.entradasFase[h] = n;
    YK.mover(state, u, h, [h]);
    YK.log(state, `${YK.nomeUnidade(u)} entra no tabuleiro por ${h} (pedágio ${n}).`);
    const zoc = YK.zocInimiga(state, u.side);
    const engaja = zoc.has(h);
    if (engaja) YK.log(state, `A unidade entra em zona de engajamento e para (6.10).`);
    return { ok: true, im: engaja ? 0 : im };
  }

  // avança para a próxima fase; cuida de reforços/ponte/fim de jogo
  function proximaFase(state) {
    // ponte instalada nesta rodada?
    if (YK.pontesEng(state) && state.ponteRodada === null) {
      state.ponteRodada = state.round;
      YK.log(state, `Ponte de engenharia instalada sobre o Canal de Suez (casa ${YK.pontesEng(state)}). ` +
        `Reforços israelenses disponíveis a partir da rodada ${state.round + 1}.`);
    }
    // os combates designados persistem de 'ataque' até 'resolve';
    // limpa apenas ao sair de uma fase de resolução ou de movimentação
    const kindAtual = FASES[state.fase].kind;
    if (kindAtual === 'resolve' || kindAtual === 'mov') state.combats = [];
    state.entradasFase = {};
    state.fase++;
    if (state.fase >= FASES.length) {
      state.fase = 0;
      state.round++;
      if (state.round > 6) {
        state.fim = YK.avaliarVitoria(state);
        const f = state.fim;
        YK.log(state, f.vencedor
          ? `Fim de jogo: vitória ${f.tipo} ${f.vencedor === 'ISR' ? 'israelense' : 'egípcia'}.`
          : 'Fim de jogo: sem vencedor.');
        return;
      }
      YK.log(state, `=== Rodada ${state.round} ===`);
    }
    // render-se? vitória decisiva antecipada não implementada — partidas vão até a rodada 6
  }

  // prepara a fase de ataque: combates obrigatórios (componentes conexos)
  function prepararAtaques(state) {
    const f = faseAtual(state);
    state.combats = YK.combates(state, f.side);
    return state.combats;
  }

  // resolução de todos os combates da rodada (fase 4/8)
  async function resolverTudo(state, decisorFactory) {
    const f = faseAtual(state);
    const lado = f.side;
    const resultados = [];
    for (const cb of state.combats) {
      // ignora combates cujos participantes já foram eliminados/recuados em cadeia
      cb.atacantes = cb.atacantes.filter(u => !u.dead && u.hex);
      cb.defensores = cb.defensores.filter(u => !u.dead && u.hex);
      // recuos de combates anteriores podem ter desfeito o engajamento
      cb.defensores = cb.defensores.filter(d =>
        cb.atacantes.some(a => YK.vizinhos(a.hex).includes(d.hex)));
      if (!cb.atacantes.length || !cb.defensores.length) continue;
      const decisor = decisorFactory(cb, lado);
      resultados.push({ cb, res: await YK.resolverCombate(state, cb, state.rng, decisor) });
    }
    return resultados;
  }

  // decisor automático (IA e recuos padrão de humanos quando não interativo)
  function decisorAuto(state, cb, ladoAtacante) {
    const valor = u => YK.icAtual(u) + (u.baixas ? -10 : 0);
    return {
      escolherBaixa: (_lado, cand) => cand.slice().sort((a, b) => valor(a) - valor(b))[0],
      escolherEliminada: (_lado, cand) => cand.slice().sort((a, b) => valor(a) - valor(b))[0],
      escolherRecuo: () => null, // heurística padrão do motor
      avancar: (combate, vagas) => {
        // avança a unidade de maior IC para a casa de melhor terreno
        const candidatos = combate.atacantes.filter(u => !u.dead && u.hex);
        if (!candidatos.length || !vagas.length) return;
        const u = candidatos.sort((a, b) => YK.icAtual(b) - YK.icAtual(a))[0];
        const h = vagas.sort((a, b) => YK.bonusTerreno(b) - YK.bonusTerreno(a))[0];
        YK.log(state, `${YK.nomeUnidade(u)} avança para ${h}.`);
        u.hex = h;
      },
    };
  }

  Object.assign(YK, {
    FASES, ENTRADAS, novoJogo, faseAtual, poolEntrada, casasEntrada,
    entrarUnidade, proximaFase, prepararAtaques, resolverTudo, decisorAuto, rngSemente,
    clonarEstado,
  });
})(typeof window !== 'undefined' ? window : globalThis);
