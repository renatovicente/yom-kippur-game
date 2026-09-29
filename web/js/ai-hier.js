// IA HIERÁRQUICA DE VERDADE (atacante israelense).
//
// Combina os dois níveis que, isolados, batem num teto:
//   ALTO NÍVEL (estratégia): um provedor de planos (LLM, via ai-hier.setProvedor)
//     propõe macro-planos; selecionamos o melhor pela cabeça de VALOR (1-ply barato).
//   BAIXO NÍVEL (tática): o micro-PUCT (ai-mcts) EXECUTA a fase de movimento,
//     enviesado pelas casas-alvo do plano escolhido — assim a busca casa-a-casa
//     persegue a estratégia em vez da doutrina heurística fixa.
//
// Resolve o gargalo medido: macro sozinho (executor heurístico) e LLM sozinho
// platôs ~17–25%; aqui o executor é aprendido (PUCT+valor), guiado pela estratégia.
(function (G) {
  G.YK = G.YK || {};
  const YK = G.YK;

  const CFG = { simulacoesMicro: 24, pesoVies: 1.2 };   // viés do plano sobre o prior
  const RECOMP = { decisiva: 1.0, parcial: 0.6, marginal: 0.3, empate: 0.0 };

  const VAL = {};
  const URL_VALOR = { ISR: 'models/ISR_selfplay.json', EGY: 'models/EGY_gnn.json' };
  function setValor(lado, m) { VAL[lado] = m; YK.IAMcts.setValor(lado, m); }
  async function garantirValor(lado) {
    if (VAL[lado]) return VAL[lado];
    if (typeof fetch !== 'function') throw new Error(`sem modelo de valor p/ ${lado}`);
    const m = await YK.IANeural.compilar(URL_VALOR[lado]);
    setValor(lado, m);
    return m;
  }

  let _provedor = null;                  // (state,lado)->Promise<[{nome,alvos}]>
  function setProvedor(fn) { _provedor = fn; }

  function leaf(state, lado, m) {
    if (state.fim) {
      const sinal = state.fim.vencedor ? (state.fim.vencedor === lado ? 1 : -1) : 0;
      return (RECOMP[state.fim.tipo] || 0) * sinal;
    }
    const v = m.valor(YK.RL.observar(state, lado));
    return typeof v === 'number' ? v : 0;
  }

  async function avancarAmbiente(state, lado) {
    let g = 0;
    while (!state.fim && g++ < 24) {
      const f = YK.faseAtual(state);
      if (f.kind === 'mov' && f.side === lado) return;
      if (f.kind === 'resolve') await YK.resolverTudo(state, (cb, l) => YK.decisorAuto(state, cb, l));
      else await YK.IA.jogarFase(state);
      YK.proximaFase(state);
    }
  }

  // converte um plano (alvos por unidade) num viés de prior do micro-PUCT:
  // ações que aproximam a unidade dos alvos do plano ganham bônus.
  function viesDoPlano(plano) {
    return (state, d, acao) => {
      if (!d) return 0;
      const u = YK.RL.unidade(state, d.uid);
      if (!u) return 0;
      const alvos = plano.alvos(state, u);
      if (!alvos || !alvos.length) return 0;
      const destino = YK.RL.HEXES[acao];
      if (!destino) return 0;                                   // PASSAR: sem bônus
      let dmin = Infinity;
      for (const a of alvos) dmin = Math.min(dmin, YK.dist(destino, a));
      // mais perto do alvo => maior prior (normalizado por uma escala de tabuleiro)
      return CFG.pesoVies * (1 - dmin / 25);
    };
  }

  async function jogarFase(state, onPasso) {
    const f = YK.faseAtual(state);
    if (f.kind !== 'mov') { await YK.IA.jogarFase(state, onPasso); return; }
    let m;
    try { m = await garantirValor(f.side); }
    catch (e) { await YK.IA.jogarFase(state, onPasso); return; }

    // 1) ALTO NÍVEL: planos candidatos (provedor LLM, senão vocabulário fixo do macro)
    let planos = null;
    if (_provedor) {
      try { planos = await _provedor(state, f.side); }
      catch (e) { YK.log(state, `Provedor de planos falhou (${e.message}).`); }
    }
    if (!planos || !planos.length) planos = YK.IAMacro ? YK.IAMacro.PLANOS : null;
    if (!planos) { await YK.IAMcts.jogarFase(state, onPasso); return; }

    // 2) seleção do plano pela cabeça de valor (1-ply: executa o plano com a
    //    heurística no clone e avalia a posição resultante — barato)
    let melhor = planos[0], best = -Infinity;
    for (const p of planos) {
      const s = YK.clonarEstado(state);
      await YK.IA.moverComPlano(s, f.side, p.alvos);
      YK.proximaFase(s);
      await avancarAmbiente(s, f.side);
      const v = leaf(s, f.side, m);
      if (v > best) { best = v; melhor = p; }
    }
    YK.log(state, `Estratégia: ${melhor.nome} (valor ${best.toFixed(3)}) — executando por micro-PUCT.`);

    // 3) BAIXO NÍVEL: micro-PUCT executa a fase enviesado pelo plano escolhido
    YK.IAMcts.config({ simulacoes: CFG.simulacoesMicro });
    YK.IAMcts.setViesPlano(viesDoPlano(melhor));
    try { await YK.IAMcts.jogarFase(state, onPasso); }
    finally { YK.IAMcts.setViesPlano(null); }
  }

  YK.IAHier = { jogarFase, config: (c) => Object.assign(CFG, c), setValor, setProvedor };
})(typeof window !== 'undefined' ? window : globalThis);
