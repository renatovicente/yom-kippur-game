// IA HIERÁRQUICA por MACRO-AÇÕES (atacante israelense).
//
// Em vez de decidir ~90 microdecisões/partida, a busca decide entre poucos PLANOS
// de alto nível por rodada (horizonte ~6). Cada plano é um "intent" estratégico que
// redireciona os ALVOS das unidades de combate (pós-ponte); o executor de baixo
// nível é a própria movimentação heurística (`YK.IA.moverComPlano`), sem duplicar
// pathfinding. A busca olha à frente algumas RODADAS — cada ramo é um plano coerente
// jogado por uma rodada inteira — e avalia as folhas pela cabeça de VALOR da rede.
// O engenheiro (ponte), a artilharia (apoio) e a escolta pré-ponte seguem a doutrina.
(function (G) {
  G.YK = G.YK || {};
  const YK = G.YK;

  const CFG = { profundidade: 3 };       // rodadas de lookahead sobre planos
  const RECOMP = { decisiva: 1.0, parcial: 0.6, marginal: 0.3, empate: 0.0 };

  // provedor de planos da RAIZ (modelo híbrido: LLM propõe). null = vocabulário
  // fixo abaixo. O lookahead recursivo SEMPRE usa os planos fixos (sem chamar API).
  let _provedor = null;
  function setProvedor(fn) { _provedor = fn; }

  const VAL = {};
  const URL_VALOR = { ISR: 'models/ISR_selfplay.json', EGY: 'models/EGY_gnn.json' };
  function setValor(lado, m) { VAL[lado] = m; }
  async function garantirValor(lado) {
    if (VAL[lado]) return VAL[lado];
    if (typeof fetch !== 'function') throw new Error(`sem modelo de valor p/ ${lado}`);
    VAL[lado] = await YK.IANeural.compilar(URL_VALOR[lado]);
    return VAL[lado];
  }

  // ---- vocabulário de planos do ATACANTE (ISR) ----
  // cada plano: (state,u) -> [hexes] OU null (cai na doutrina padrão).
  // Só age sobre unidades de COMBATE e só PÓS-ponte: a decisão estratégica é onde
  // concentrar o assalto entre os objetivos espalhados. Antes da ponte (escolta) e
  // para engenheiro/artilharia, devolve null (doutrina).
  function ehCombate(u) { return !YK.ehArtilharia(u) && u.tipo !== 'eng' && u.tipo !== 'sam'; }
  function soPendentes(state, hexes) {
    const p = hexes.filter(h => YK.valido(h) && !YK.controla(state, h, 'ISR'));
    return p.length ? p : hexes;
  }
  function combatePosPonte(state, u) {
    return u.side === 'ISR' && ehCombate(u) && !!state.ponteRodada;
  }
  const PLANOS = [
    { nome: 'TODOS',      alvos: () => null },                                  // = doutrina
    { nome: 'NORTE',      alvos: (s, u) => combatePosPonte(s, u) ? soPendentes(s, ['1202', '0722']) : null },
    { nome: 'SUL',        alvos: (s, u) => combatePosPonte(s, u) ? soPendentes(s, ['0803', '0621']) : null },
    { nome: 'SAMS',       alvos: (s, u) => combatePosPonte(s, u)
        ? (YK.IA.SAM_HEXES ? soPendentes(s, YK.IA.SAM_HEXES()) : null) : null },
    { nome: 'CONSOLIDAR', alvos: (s, u) => combatePosPonte(s, u) ? [u.hex] : null },
  ];

  function leaf(state, lado, m) {
    if (state.fim) {
      const sinal = state.fim.vencedor ? (state.fim.vencedor === lado ? 1 : -1) : 0;
      return (RECOMP[state.fim.tipo] || 0) * sinal;
    }
    const v = m.valor(YK.RL.observar(state, lado));
    return typeof v === 'number' ? v : 0;
  }

  // avança o clone pelas fases não-decididas até a próxima fase de MOV do `lado`
  // (combate por decisorAuto; demais fases e a rodada adversária pela heurística)
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

  // busca max sobre sequências de planos (oponente = heurística, dobrado na
  // transição → busca de agente único, sem min/max). Devolve o melhor valor.
  async function buscar(state, lado, m, depth) {
    if (state.fim || depth <= 0) return leaf(state, lado, m);
    let best = -Infinity;
    for (const plano of PLANOS) {
      const s = YK.clonarEstado(state);
      await YK.IA.moverComPlano(s, lado, plano.alvos);   // executa a fase de mov sob o plano
      YK.proximaFase(s);
      await avancarAmbiente(s, lado);                     // combate + rodada do oponente
      const v = await buscar(s, lado, m, depth - 1);
      if (v > best) best = v;
    }
    return best;
  }

  // escolhe o melhor plano para a fase de movimento corrente e o executa de verdade
  async function jogarFase(state, onPasso) {
    const f = YK.faseAtual(state);
    if (f.kind !== 'mov') { await YK.IA.jogarFase(state, onPasso); return; }
    let m;
    try { m = await garantirValor(f.side); }
    catch (e) { await YK.IA.jogarFase(state, onPasso); return; }   // sem valor: heurística

    // planos da raiz: do provedor (LLM) se houver, senão o vocabulário fixo
    let planosRaiz = PLANOS;
    if (_provedor) {
      try { const p = await _provedor(state, f.side); if (p && p.length) planosRaiz = p; }
      catch (e) { YK.log(state, `Provedor de planos falhou (${e.message}); usando fixos.`); }
    }
    let melhor = planosRaiz[0], melhorV = -Infinity;
    for (const plano of planosRaiz) {
      const s = YK.clonarEstado(state);
      await YK.IA.moverComPlano(s, f.side, plano.alvos);
      YK.proximaFase(s);
      await avancarAmbiente(s, f.side);
      const v = await buscar(s, f.side, m, CFG.profundidade - 1);
      if (v > melhorV) { melhorV = v; melhor = plano; }
    }
    YK.log(state, `Plano escolhido: ${melhor.nome} (valor ${melhorV.toFixed(3)}).`);
    await YK.IA.moverComPlano(state, f.side, melhor.alvos, null);
    if (onPasso) await onPasso();
  }

  YK.IAMacro = { jogarFase, config: (c) => Object.assign(CFG, c), setValor, setProvedor, PLANOS };
})(typeof window !== 'undefined' ? window : globalThis);
