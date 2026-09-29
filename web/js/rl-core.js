// Núcleo de codificação RL — fila de microdecisões, observação e máscara.
// FONTE ÚNICA usada tanto pelo ambiente de treino (rl/env.mjs) quanto pela
// inferência no jogo (web/js/ai-neural.js). Operar a partir daqui garante que
// a rede neural veja, no jogo, exatamente o mesmo formato que viu no treino.
(function (G) {
  G.YK = G.YK || {};
  const YK = G.YK;

  const HEXES = Object.keys(YK.MAP.terrain).sort();
  const IDX = new Map(HEXES.map((h, i) => [h, i]));
  const ACAO_PASSAR = HEXES.length;          // 538
  const N_ACOES = HEXES.length + 1;          // 539

  const TERRENOS = ['aberto', 'dunas', 'bosque', 'acidentado', 'cidade', 'agua'];
  const OBJETIVOS = new Set(['0803', '1202', '0621', '0722']);
  const N_PLANOS = 20;
  const OBS_TAM = HEXES.length * N_PLANOS + 8 + 8;

  function unidade(state, id) { return state.units.find(u => u.id === id); }

  function artilharias(state, lado) {
    return state.units.filter(u =>
      u.side === lado && !u.dead && u.hex && YK.ehArtilharia(u));
  }

  // monta a fila de decisões da fase atual para `lado` (ataque tem efeito
  // colateral: prepara os combates obrigatórios)
  function montarFila(state, lado) {
    const f = YK.faseAtual(state);
    const fila = [];
    if (f.kind === 'mov') {
      for (const u of YK.poolEntrada(state, lado))
        fila.push({ tipo: 'entrada', uid: u.id, lado });
      for (const u of state.units) {
        if (u.side !== lado || u.dead || !u.hex || u.tipo === 'sam') continue;
        fila.push({ tipo: 'mover', uid: u.id, lado });
      }
    } else if (f.kind === 'ataque') {
      YK.prepararAtaques(state);
      for (const u of artilharias(state, lado)) fila.push({ tipo: 'barragem', uid: u.id, lado });
    } else if (f.kind === 'cobertura') {
      for (const u of artilharias(state, lado)) fila.push({ tipo: 'cobertura', uid: u.id, lado });
    }
    return fila;
  }

  // máscara de ações legais para a decisão `d`
  function mascaraDecisao(state, d) {
    const m = new Uint8Array(N_ACOES);
    m[ACAO_PASSAR] = 1;
    if (!d) return m;
    const u = unidade(state, d.uid);
    if (!u || u.dead) return m;
    if (d.tipo === 'entrada') {
      for (const h of YK.casasEntrada(state, u)) m[IDX.get(h)] = 1;
    } else if (d.tipo === 'mover' || d.tipo === 'moverResto') {
      if (!u.hex || YK.engajada(state, u)) return m;
      const alc = YK.alcance(state, u, d.budget);
      for (const h of alc.keys()) m[IDX.get(h)] = 1;
    } else if (d.tipo === 'barragem' || d.tipo === 'cobertura') {
      if (u.fired === state.round || YK.engajada(state, u)) return m;
      const lista = d.tipo === 'barragem' ? 'barragem' : 'cobertura';
      for (const cb of state.combats) {
        if (cb[lista].includes(u)) continue;
        if (!YK.artilhariasDisponiveis(state, d.lado, cb).includes(u)) continue;
        for (const def of cb.defensores) if (def.hex) m[IDX.get(def.hex)] = 1;
      }
    }
    return m;
  }

  // aplica a ação à decisão `d`; devolve { resto } se gerou um movimento de
  // continuação (entrada com mobilidade restante)
  function aplicarDecisao(state, d, acao) {
    if (acao === ACAO_PASSAR) return { resto: null };
    const h = HEXES[acao];
    const u = unidade(state, d.uid);
    if (!u) return { resto: null };
    if (d.tipo === 'entrada') {
      const r = YK.entrarUnidade(state, u, h);
      if (r.ok && r.im > 0 && !YK.engajada(state, u))
        return { resto: { tipo: 'moverResto', uid: u.id, lado: d.lado, budget: r.im } };
    } else if (d.tipo === 'mover' || d.tipo === 'moverResto') {
      const alc = YK.alcance(state, u, d.budget);
      const info = alc.get(h);
      if (info) YK.mover(state, u, h, info.caminho);
    } else {
      const lista = d.tipo === 'barragem' ? 'barragem' : 'cobertura';
      const cb = state.combats.find(c => c.defensores.some(x => x.hex === h));
      if (cb) cb[lista].push(u);
    }
    return { resto: null };
  }

  // observação relativa ao `lado` que decide (próprias/inimigas trocam de plano)
  function observar(state, lado) {
    const opp = lado === 'ISR' ? 'EGY' : 'ISR';
    const n = HEXES.length;
    const obs = new Float32Array(OBS_TAM);
    const eng = state.units.find(u => u.tipo === 'eng' && !u.dead && u.hex);
    for (let i = 0; i < n; i++) {
      const h = HEXES[i];
      const t = YK.MAP.terrain[h];
      obs[TERRENOS.indexOf(t) * n + i] = 1;
      if (YK.ROADHEX.has(h)) obs[6 * n + i] = 1;
      if (YK.oeste(h)) obs[7 * n + i] = 1;
      if (OBJETIVOS.has(h)) obs[8 * n + i] = 1;
    }
    for (const u of state.units) {
      if (u.dead || !u.hex) continue;
      const i = IDX.get(u.hex);
      if (u.tipo === 'sam') { obs[9 * n + i] = 1; continue; }
      const base = (u.side === lado) ? 10 : 15;
      obs[base * n + i] = 1;
      obs[(base + 1) * n + i] = YK.icAtual(u) / 5;
      obs[(base + 2) * n + i] = YK.imAtual(u) / 20;
      obs[(base + 3) * n + i] = u.baixas;
      obs[(base + 4) * n + i] = YK.ehArtilharia(u) && u.fired !== state.round ? 1 : 0;
    }
    let k = N_PLANOS * n;
    obs[k + state.fase] = 1;
    k += 8;
    obs[k++] = state.round / 6;
    obs[k++] = state.ponteRodada !== null ? 1 : 0;
    obs[k++] = eng && YK.elegivelPonte(eng.hex) ? 1 : 0;
    obs[k++] = YK.poolEntrada(state, lado).length / 10;
    obs[k++] = YK.poolEntrada(state, opp).length / 10;
    obs[k++] = state.units.filter(u => u.side === lado && u.dead).length / 10;
    obs[k++] = state.units.filter(u => u.side === opp && u.dead).length / 10;
    obs[k++] = lado === 'ISR' ? 1 : 0;
    return obs;
  }

  // existe alguma ação legal além de PASSAR?
  function temAcaoReal(mask) {
    for (let i = 0; i < ACAO_PASSAR; i++) if (mask[i]) return true;
    return false;
  }

  // ---------- layout espacial (para inferência CNN/GNN) ----------
  const COLS = 25, ROWS = 22;
  // célula linear na grade ROWS×COLS de cada casa
  const CELL = HEXES.map(h => (parseInt(h.slice(2), 10) - 1) * COLS + (parseInt(h.slice(0, 2), 10) - 1));
  // adjacência normalizada (lista de vizinhos por casa, em índices)
  const VIZ = HEXES.map(h => YK.vizinhos(h).map(n => IDX.get(n)));

  YK.RL = {
    HEXES, IDX, ACAO_PASSAR, N_ACOES, OBS_TAM,
    unidade, artilharias, montarFila, mascaraDecisao, aplicarDecisao,
    observar, temAcaoReal,
    COLS, ROWS, N_PLANOS, CELL, VIZ,
  };
})(typeof window !== 'undefined' ? window : globalThis);
