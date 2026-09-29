// IA com BUSCA PUCT + REDE COMO VALOR (AlphaZero-lite).
//
// Substitui o rollout-até-o-fim (limitado pelo teto da heurística e lento) por
// uma árvore de busca PUCT em que:
//   • o PRIOR de cada ação vem da cabeça de POLÍTICA da rede treinada;
//   • a AVALIAÇÃO de folha vem da cabeça de VALOR (crítico do PPO) — que foi
//     treinada para prever o desfecho graduado da partida, dando à busca um
//     horizonte estratégico longo sem precisar simular o jogo inteiro.
//
// O adversário e o acaso (CRT 2d6) são DOBRADOS no modelo de transição: a
// heurística joga a rodada do oponente e `decisorAuto` resolve os combates sobre
// o estado clonado. Assim cada nó é "uma decisão nossa" e o valor é sempre da
// nossa perspectiva — busca de agente único contra um modelo fixo de mundo,
// sem alternância min/max. Só a fase de MOVIMENTO é ramificada; as fases de
// ataque/cobertura/resolução usam a política base (já competentes nelas).
(function (G) {
  G.YK = G.YK || {};
  const YK = G.YK;

  const CFG = {
    simulacoes: 48,          // orçamento de buscas por microdecisão
    cpuct: 1.5,              // exploração do PUCT
    topK: 6,                 // ações candidatas (priorizadas pela política)
    profundidadeRodadas: 4,  // quantas das NOSSAS rodadas olhar à frente
    dirichletAlpha: 0.5,     // ruído de exploração na raiz (auto-jogo AZ)
    dirichletEps: 0.25,      // peso da mistura Dirichlet
    reamostraChance: false,  // re-amostrar combate (expectimax amostral): medido
                             // NEUTRO no win% e ~40% mais lento → off por padrão
    // FONTE DOS CANDIDATOS/PRIOR na expansão:
    //   'politica'   top-K da cabeça de política (original)
    //   'uniao'      top-K da política ∪ o lance que a heurística faria (a busca nunca
    //                deixa de considerar a doutrina; medido: o lance heurístico só está
    //                no top-6 da política em 19% das decisões)
    //   'heuristica' candidatos e prior pelas NOTAS da heurística (softmax nota/tau);
    //                a rede só entra como VALOR — útil p/ o defensor, cuja heurística
    //                é mais forte que a política aprendida
    prior: 'politica',
    betaHeur: 0.3,           // massa de prior dada ao lance heurístico ('uniao')
    tauHeur: 10,             // temperatura das notas heurísticas ('heuristica')
    // sobrescritas por lado. Padrão = agentes de equilíbrio da população (RL.md
    // §12e): Israel com candidatos em UNIÃO (23,5%→55% contra a heurística, mesmo
    // modelo); Egito com prior de POLÍTICA (o prior heurístico deixou o atacante
    // re-treinado subir de 3% para 42%).
    lado: { ISR: { prior: 'uniao' }, EGY: { prior: 'politica' } },
  };
  // parâmetro efetivo para um lado (permite PUCT×PUCT com configurações distintas)
  function C(lado, k) {
    const o = CFG.lado && CFG.lado[lado];
    return (o && k in o) ? o[k] : CFG[k];
  }

  // recompensa graduada terminal (mesma escala do treino do crítico)
  const RECOMP = { decisiva: 1.0, parcial: 0.6, marginal: 0.3, empate: 0.0 };

  // modelos com cabeça de VALOR por lado (cache próprio, separado do menu Neural)
  const VAL = {};
  // modelos de equilíbrio da população (RL.md §12e): ISR re-treinado contra o
  // defensor atual; EGY re-treinado contra esse atacante (o defensor mais robusto)
  const URL_VALOR = { ISR: 'models/ISR_v3.json', EGY: 'models/EGY_v2.json' };

  function setValor(lado, m) { VAL[lado] = m; }          // injeção (testes em Node)

  // viés de macro-plano sobre o prior (ai-hier): (state, decisao, acao)->bônus
  let _viesPlano = null;
  function setViesPlano(fn) { _viesPlano = fn; }
  async function garantirValor(lado) {
    if (VAL[lado]) return VAL[lado];
    if (typeof fetch !== 'function')
      throw new Error(`sem modelo de valor para ${lado} (injete via setValor em Node)`);
    VAL[lado] = await YK.IANeural.compilar(URL_VALOR[lado]);
    return VAL[lado];
  }

  // política base das fases não buscadas (combate): heurística (rápida e competente)
  function base() { return YK.IA; }

  // ---------------------------------------------------------------- nós da árvore
  // cada nó = um estado clonado numa decisão NOSSA de movimento.
  function makeNode(ctx, s, fila, depth) {
    const node = {
      state: s, fila, depth, terminal: !!s.fim, expanded: false,
      acoes: [], P: {}, N: {}, W: {}, Nsum: 0, children: {}, estoc: {}, valLeaf: 0,
    };
    if (s.fim) {
      const sinal = s.fim.vencedor ? (s.fim.vencedor === ctx.lado ? 1 : -1) : 0;
      node.valLeaf = (RECOMP[s.fim.tipo] || 0) * sinal;
    } else {
      const v = ctx.m.valor(YK.RL.observar(s, ctx.lado));
      node.valLeaf = typeof v === 'number' ? v : 0;   // folha = valor do crítico
    }
    return node;
  }

  // lance que a heurística faria nesta decisão, como índice de ação (ficar = PASSAR)
  function acaoHeuristica(state, d) {
    const u = YK.RL.unidade(state, d.uid);
    if (!u) return null;
    let h = null;
    if (d.tipo === 'entrada') {
      const e = YK.IA.entradasHeuristicas(state, u);
      h = e.length ? e[0].h : null;
    } else if (d.tipo === 'mover' || d.tipo === 'moverResto') {
      h = YK.IA.lanceHeuristico(state, u, d.budget);
    }
    if (!h) return null;
    return h === u.hex ? YK.RL.ACAO_PASSAR : YK.RL.IDX.get(h);
  }

  // notas heurísticas de todas as ações da decisão: Map(acao -> nota)
  function notasHeuristicas(state, d) {
    const u = YK.RL.unidade(state, d.uid);
    const notas = new Map();
    if (!u) return notas;
    if (d.tipo === 'entrada') {
      const e = YK.IA.entradasHeuristicas(state, u);
      for (const x of e) notas.set(YK.RL.IDX.get(x.h), x.s);
      if (e.length) notas.set(YK.RL.ACAO_PASSAR, e[e.length - 1].s - 50);   // não entrar: pior
    } else if (d.tipo === 'mover' || d.tipo === 'moverResto') {
      for (const x of YK.IA.avaliarLances(state, u, d.budget))
        notas.set(x.h === u.hex ? YK.RL.ACAO_PASSAR : YK.RL.IDX.get(x.h), x.s);
    }
    return notas;
  }

  function softmaxEm(node, acoes, valor, tau) {
    let mx = -Infinity;
    for (const a of acoes) mx = Math.max(mx, valor(a) / tau);
    let z = 0;
    for (const a of acoes) { const e = Math.exp(valor(a) / tau - mx); node.P[a] = e; z += e; }
    for (const a of acoes) node.P[a] /= z;
  }

  // expande: deriva ações candidatas (topK) e priores (política, união ou heurística)
  function expand(ctx, node) {
    const d = node.fila[0];
    const mask = YK.RL.mascaraDecisao(node.state, d);
    const legais = [];
    for (let a = 0; a < mask.length; a++) if (mask[a]) legais.push(a);
    node.expanded = true;
    if (legais.length <= 1) {
      node.acoes = legais;
      if (legais.length) node.P[legais[0]] = 1;
      return;
    }
    const modo = C(ctx.lado, 'prior');
    const K = C(ctx.lado, 'topK');
    if (modo === 'heuristica') {
      const notas = notasHeuristicas(node.state, d);
      const nota = a => (notas.has(a) ? notas.get(a) : -1e6);
      const top = legais.slice().sort((x, y) => nota(y) - nota(x)).slice(0, K);
      softmaxEm(node, top, nota, C(ctx.lado, 'tauHeur'));
      node.acoes = top;
      return;
    }
    const lg = ctx.m.logits(YK.RL.observar(node.state, ctx.lado));
    // VIÉS HIERÁRQUICO (ai-hier): um macro-plano de alto nível adiciona atração
    // pelas suas casas-alvo ao prior, fazendo a busca tática perseguir a estratégia.
    if (_viesPlano) {
      const d = node.fila[0];
      for (const a of legais) lg[a] += _viesPlano(node.state, d, a);
    }
    legais.sort((x, y) => lg[y] - lg[x]);
    const top = legais.slice(0, K);
    softmaxEm(node, top, a => lg[a], 1);          // softmax sobre as legais
    if (modo === 'uniao') {
      // garante o lance doutrinário entre os candidatos, com massa betaHeur
      const ah = acaoHeuristica(node.state, d);
      if (ah != null && mask[ah]) {
        if (!top.includes(ah)) { top.push(ah); node.P[ah] = 0; }
        const b = C(ctx.lado, 'betaHeur');
        for (const a of top) node.P[a] = (1 - b) * node.P[a] + (a === ah ? b : 0);
      }
    }
    node.acoes = top;
  }

  // seleção PUCT: Q + cpuct·P·√ΣN/(1+N)  (FPU = 0 para ação não visitada)
  function selecionar(ctx, node) {
    const cpuct = C(ctx.lado, 'cpuct');
    const sqrtN = Math.sqrt(node.Nsum + 1);
    let best = node.acoes[0], bu = -Infinity;
    for (const a of node.acoes) {
      const n = node.N[a] || 0;
      const q = n ? node.W[a] / n : 0;
      const u = q + cpuct * (node.P[a] || 0) * sqrtN / (1 + n);
      if (u > bu) { bu = u; best = a; }
    }
    return best;
  }

  // cria o filho: aplica a ação no clone e avança o "mundo" (combates + rodada
  // adversária pela heurística) até a NOSSA próxima fase de movimento.
  async function criarFilho(ctx, node, a) {
    const s = YK.clonarEstado(node.state);
    const d = node.fila[0];
    const { resto } = YK.RL.aplicarDecisao(s, d, a);
    let fila = node.fila.slice(1);
    if (resto) fila.unshift(resto);
    let depth = node.depth;
    let estocastico = false;
    if (fila.length === 0 && !s.fim) {
      YK.proximaFase(s);                 // sai da nossa fase de movimento
      const antesComb = state_temCombatePendente(s);
      await avancarAmbiente(ctx, s);     // joga combates + rodada do oponente
      depth -= 1;                        // uma rodada nossa consumida
      fila = s.fim ? [] : YK.RL.montarFila(s, ctx.lado);
      estocastico = antesComb;           // cruzou resolução de combate (dados 2d6)
    }
    return { no: makeNode(ctx, s, fila, depth), estocastico };
  }

  // há combate a resolver (dados) entre aqui e a nossa próxima fase de movimento?
  function state_temCombatePendente(s) {
    // a transição de rodada passa por fases 'resolve'; se há unidades de ambos os
    // lados no tabuleiro, é praticamente certo haver combate estocástico.
    const isr = s.units.some(u => u.side === 'ISR' && !u.dead && u.hex && u.tipo !== 'sam');
    const egy = s.units.some(u => u.side === 'EGY' && !u.dead && u.hex && u.tipo !== 'sam');
    return isr && egy;
  }

  // avança o estado clonado pelas fases que NÃO buscamos, até voltar a ser a
  // nossa vez de mover (ou a partida acabar). Combate por decisorAuto; demais
  // fases (inclusive ataque/cobertura nossas e a rodada do oponente) pela base.
  async function avancarAmbiente(ctx, s) {
    let g = 0;
    while (!s.fim && g++ < 24) {
      const f = YK.faseAtual(s);
      if (f.kind === 'mov' && f.side === ctx.lado) return;
      if (f.kind === 'resolve') await YK.resolverTudo(s, (cb, l) => YK.decisorAuto(s, cb, l));
      else await base().jogarFase(s);
      YK.proximaFase(s);
    }
  }

  async function simulate(ctx, node) {
    if (node.terminal || node.fila.length === 0 || node.depth <= 0) return node.valLeaf;
    if (!node.expanded) { expand(ctx, node); return node.valLeaf; }   // folha NN
    if (node.acoes.length === 0) return node.valLeaf;
    const a = selecionar(ctx, node);
    // arestas determinísticas (movimento dentro da fase) ficam em cache; arestas
    // que cruzam COMBATE (dados 2d6) são re-amostradas a cada visita → o Q vira a
    // média Monte-Carlo sobre os desfechos da CRT (expectimax amostral, menos ruído).
    let child = node.children[a];
    if (!child || node.estoc[a]) {
      const r = await criarFilho(ctx, node, a);
      child = r.no;
      if (r.estocastico && CFG.reamostraChance) node.estoc[a] = true;  // re-amostra
      else node.children[a] = child;               // determinístico/padrão: cacheia
    }
    const v = await simulate(ctx, child);
    node.N[a] = (node.N[a] || 0) + 1;
    node.W[a] = (node.W[a] || 0) + v;
    node.Nsum++;
    return v;
  }

  // ---- ruído de exploração (auto-jogo AlphaZero) ----
  // amostra Gamma(alpha,1) (Marsaglia-Tsang; alpha<1 via boosting U^(1/alpha))
  function gama(alpha) {
    if (alpha < 1) return gama(alpha + 1) * Math.pow(Math.random() || 1e-12, 1 / alpha);
    const d = alpha - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x, v;
      do { x = gauss(); v = 1 + c * x; } while (v <= 0);
      v = v * v * v; const u = Math.random();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }
  function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  // mistura Dirichlet(alpha) nos priores da raiz: P <- (1-eps)P + eps*Dir
  function ruidoDirichlet(raiz, alpha, eps) {
    const g = raiz.acoes.map(() => gama(alpha));
    const z = g.reduce((s, x) => s + x, 0) || 1;
    raiz.acoes.forEach((a, i) => { raiz.P[a] = (1 - eps) * raiz.P[a] + eps * (g[i] / z); });
  }

  // núcleo da busca: constrói a raiz, opcionalmente injeta ruído, roda as
  // simulações e devolve a raiz expandida (com contagens de visita).
  async function buscarRaiz(state, fila, lado, opts) {
    const ctx = { m: VAL[lado], lado };
    const raiz = makeNode(ctx, YK.clonarEstado(state), fila.slice(), C(lado, 'profundidadeRodadas'));
    expand(ctx, raiz);
    if (raiz.acoes.length <= 1) return raiz;
    if (opts && opts.ruido) ruidoDirichlet(raiz, CFG.dirichletAlpha, CFG.dirichletEps);
    const sims = (opts && opts.simulacoes) || C(lado, 'simulacoes');
    for (let i = 0; i < sims; i++) await simulate(ctx, raiz);
    return raiz;
  }

  // ação mais visitada (robusta), desempate por Q
  function maisVisitada(raiz) {
    let best = raiz.acoes[0], bn = -1, bq = -Infinity;
    for (const a of raiz.acoes) {
      const n = raiz.N[a] || 0, q = n ? raiz.W[a] / n : -Infinity;
      if (n > bn || (n === bn && q > bq)) { best = a; bn = n; bq = q; }
    }
    return best;
  }

  // busca a melhor ação para a decisão do topo da fila por PUCT
  async function buscarAcao(state, fila, lado) {
    const raiz = await buscarRaiz(state, fila, lado, null);
    if (raiz.acoes.length <= 1) return raiz.acoes[0] ?? YK.RL.ACAO_PASSAR;
    return maisVisitada(raiz);
  }

  // ANÁLISE p/ auto-jogo AlphaZero: roda a busca (com ruído de exploração) e
  // devolve { acao, pi } — pi é a distribuição de visitas da raiz (alvo de treino,
  // ∝ N, temperatura 1). A AÇÃO é amostrada de N^(1/τ) (τ=opts.temperatura;
  // τ→0 = argmax). Se a decisão é trivial, pi fica degenerada nessa ação.
  async function analisar(state, fila, lado, opts) {
    opts = opts || {};
    const raiz = await buscarRaiz(state, fila, lado, { ruido: !!opts.ruido, simulacoes: opts.simulacoes });
    if (raiz.acoes.length <= 1) {
      const a = raiz.acoes[0] ?? YK.RL.ACAO_PASSAR;
      return { acao: a, pi: [[a, 1]] };
    }
    const visitas = raiz.acoes.map(a => raiz.N[a] || 0);
    const somaV = visitas.reduce((s, x) => s + x, 0);
    // alvo de treino: ∝ visitas (τ=1); se nenhuma visita, cai no prior
    const pi = somaV > 0
      ? raiz.acoes.map((a, i) => [a, visitas[i] / somaV])
      : raiz.acoes.map(a => [a, raiz.P[a] || 0]);
    // seleção da ação jogada
    let acao;
    const tau = opts.temperatura;
    if (!tau || tau < 1e-3 || somaV === 0) {
      acao = maisVisitada(raiz);
    } else {
      const peso = visitas.map(n => Math.pow(n, 1 / tau));
      const zp = peso.reduce((s, x) => s + x, 0) || 1;
      let r = Math.random() * zp, k = 0;
      while (k < peso.length - 1 && (r -= peso[k]) > 0) k++;
      acao = raiz.acoes[k];
    }
    return { acao, pi };
  }

  async function jogarFase(state, onPasso) {
    const f = YK.faseAtual(state);
    if (f.kind !== 'mov') { await base().jogarFase(state, onPasso); return; }
    try { await garantirValor(f.side); }
    catch (e) { YK.log(state, `Busca sem modelo de valor: usando heurística (${e.message}).`); await base().jogarFase(state, onPasso); return; }
    let fila = YK.RL.montarFila(state, f.side);
    let guarda = 0;
    while (fila.length && guarda++ < 300) {
      const d = fila[0];
      const mask = YK.RL.mascaraDecisao(state, d);
      let acao = YK.RL.ACAO_PASSAR;
      if (YK.RL.temAcaoReal(mask)) acao = await buscarAcao(state, fila, f.side);
      const houve = acao !== YK.RL.ACAO_PASSAR;
      if (houve) registra(state, d, acao);
      const { resto } = YK.RL.aplicarDecisao(state, d, acao);
      fila.shift();
      if (resto) fila.unshift(resto);
      if (onPasso && houve) await onPasso();
    }
  }

  function registra(state, d, acao) {
    const u = YK.RL.unidade(state, d.uid); if (!u) return;
    const destino = YK.RL.HEXES[acao], nome = YK.nomeUnidade(u);
    if (d.tipo === 'entrada') YK.log(state, `${nome} entra no tabuleiro por ${destino}.`);
    else if (u.hex !== destino) YK.log(state, `${nome} move-se de ${u.hex} para ${destino}. (busca PUCT)`);
  }

  YK.IAMcts = {
    jogarFase,
    analisar,
    config: (c) => Object.assign(CFG, c),
    configLado: (lado, c) => { CFG.lado[lado] = { ...(CFG.lado[lado] || {}), ...c }; },
    setValor,
    setViesPlano,
  };
})(typeof window !== 'undefined' ? window : globalThis);
