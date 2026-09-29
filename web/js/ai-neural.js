// IA Neural — joga com uma política treinada por RL, reusando o núcleo de
// codificação (YK.RL) para ver o estado exatamente como no treino.
//
// Suporta três arquiteturas (MLP/CNN/GNN) por meio de um INTERPRETADOR de
// camadas: o policy.json descreve a rede como uma lista de operações; o mesmo
// motor (em JS) executa qualquer uma delas, sem dependências externas. Também
// aceita o formato MLP legado da Fase A (sem `layers`).
(function (G) {
  G.YK = G.YK || {};
  const YK = G.YK;

  const modelos = {};   // lado -> { url, m }  (m = modelo compilado)

  function f32(b64) {
    const bin = atob(b64);
    const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return new Float32Array(a.buffer);
  }

  // compila um modelo a partir de uma URL, sem registrá-lo por lado (usado tanto
  // por `carregar` quanto pela busca PUCT, que mantém seu próprio cache de valor)
  async function compilar(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`falha ao carregar ${url}: ${resp.status}`);
    const pj = await resp.json();
    return pj.layers ? compilaSpec(pj) : compilaLegado(pj);
  }

  async function carregar(lado, url) {
    if (modelos[lado] && modelos[lado].url === url) return modelos[lado].m;
    const m = await compilar(url);
    modelos[lado] = { url, m };
    return m;
  }
  // registra um modelo já compilado (Node/arena: sem fetch de arquivo)
  function definir(lado, m, url) { modelos[lado] = { url: url || '(injetado)', m }; }
  function carregado(lado, url) {
    return !!modelos[lado] && (!url || modelos[lado].url === url);
  }

  // ---------- formato MLP legado (Fase A): W já transposto [nin,nout] ----------
  function compilaLegado(pj) {
    const [D, H1, H2] = pj.meta.dims;
    const W1 = f32(pj.W1), b1 = f32(pj.b1), W2 = f32(pj.W2), b2 = f32(pj.b2);
    const Wp = f32(pj.Wp), bp = f32(pj.bp);
    const densaT = (x, W, b, nin, nout, tanh) => {   // W layout [nin,nout]
      const y = new Float32Array(nout);
      for (let j = 0; j < nout; j++) y[j] = b[j];
      for (let i = 0; i < nin; i++) {
        const xi = x[i]; if (xi === 0) continue;
        const base = i * nout;
        for (let j = 0; j < nout; j++) y[j] += xi * W[base + j];
      }
      if (tanh) for (let j = 0; j < nout; j++) y[j] = Math.tanh(y[j]);
      return y;
    };
    function logits(obs) {
      const z1 = densaT(obs, W1, b1, D, H1, true);
      const z2 = densaT(z1, W2, b2, H1, H2, true);
      return densaT(z2, Wp, bp, H2, YK.RL.N_ACOES, false);
    }
    // o MLP legado da Fase A não exportou a cabeça de valor (só a política)
    return { logits, valor: () => null, forward: (obs) => ({ logits: logits(obs), valor: null }) };
  }

  // ---------- interpretador genérico de camadas ----------
  const tanh = x => Math.tanh(x);
  const relu = x => (x > 0 ? x : 0);
  const ATIV = { tanh, relu, none: x => x };

  // densa y[o]=b[o]+sum_i W[o*nin+i]*x[i]  (W layout PyTorch [nout,nin])
  function densa(x, W, b, nin, nout, act) {
    const fn = ATIV[act || 'none'];
    const y = new Float32Array(nout);
    for (let o = 0; o < nout; o++) {
      let s = b[o], base = o * nin;
      for (let i = 0; i < nin; i++) s += W[base + i] * x[i];
      y[o] = fn(s);
    }
    return y;
  }

  function globais(obs) {
    return obs.subarray(YK.RL.N_PLANOS * YK.RL.HEXES.length);
  }

  function compilaSpec(pj) {
    const arch = pj.arch;
    const NHEX = YK.RL.HEXES.length, NA = YK.RL.N_ACOES;
    const CELL = YK.RL.CELL, VIZ = YK.RL.VIZ;
    const ROWS = YK.RL.ROWS, COLS = YK.RL.COLS, NC = ROWS * COLS;
    const NPL = YK.RL.N_PLANOS;
    const L = pj.layers.map(l => {
      const o = { ...l };
      for (const k of ['W', 'b', 'Wpi', 'bpi', 'Whex', 'bhex', 'Wg', 'bg', 'Wpass', 'bpass', 'Wv', 'bv'])
        if (o[k]) o[k] = f32(o[k]);
      return o;
    });

    // forward completo: devolve { logits[NA], valor } — o valor sai da MESMA
    // cabeça de valor (Wv/bv) treinada como crítico do PPO, reusando o tronco.
    function forward(obs) {
      if (arch === 'mlp') {
        let x = obs;
        for (const l of L) {
          if (l.op === 'linear') x = densa(x, l.W, l.b, l.nin, l.nout, l.act);
          else if (l.op === 'heads') {
            const logits = densa(x, l.Wpi, l.bpi, l.nin, l.nacoes, 'none');
            const valor = l.Wv ? densa(x, l.Wv, l.bv, l.nin, 1, 'none')[0] : null;
            return { logits, valor };
          }
        }
      } else if (arch === 'cnn') {
        // estado espacial [C][NC]
        let x = [], C = NPL;
        for (let c = 0; c < NPL; c++) {
          const plano = new Float32Array(NC);
          for (let h = 0; h < NHEX; h++) plano[CELL[h]] = obs[c * NHEX + h];
          x.push(plano);
        }
        for (const l of L) {
          if (l.op === 'conv') { x = conv(x, l, C); C = l.cout; }
          else if (l.op === 'cnn_heads') return cnnHeads(x, C, l, obs);
        }
      } else if (arch === 'gnn') {
        // estado nós [NHEX][F]
        let x = new Array(NHEX), F = NPL;
        for (let h = 0; h < NHEX; h++) {
          const v = new Float32Array(NPL);
          for (let c = 0; c < NPL; c++) v[c] = obs[c * NHEX + h];
          x[h] = v;
        }
        for (const l of L) {
          if (l.op === 'gnn') { x = gnnLayer(x, l, F); F = l.fout; }
          else if (l.op === 'gnn_heads') return gnnHeads(x, F, l, obs);
        }
      }
      throw new Error('spec sem cabeça: ' + arch);
    }

    function conv(x, l, cin) {
      const out = [];
      for (let co = 0; co < l.cout; co++) {
        const plano = new Float32Array(NC);
        const bco = l.b[co];
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
          let s = bco;
          for (let ci = 0; ci < cin; ci++) {
            const xci = x[ci], wbase = ((co * cin + ci) * 3) * 3;
            for (let kr = -1; kr <= 1; kr++) {
              const rr = r + kr; if (rr < 0 || rr >= ROWS) continue;
              for (let kc = -1; kc <= 1; kc++) {
                const cc = c + kc; if (cc < 0 || cc >= COLS) continue;
                s += xci[rr * COLS + cc] * l.W[wbase + (kr + 1) * 3 + (kc + 1)];
              }
            }
          }
          plano[r * COLS + c] = relu(s);
        }
        out.push(plano);
      }
      return out;
    }

    function cnnHeads(x, C, l, obs) {
      const out = new Float32Array(NA);
      for (let h = 0; h < NHEX; h++) {        // 1 logit por casa (conv 1x1)
        let s = l.bhex[0], cell = CELL[h];
        for (let ci = 0; ci < C; ci++) s += l.Whex[ci] * x[ci][cell];
        out[h] = s;
      }
      const pool = new Float32Array(C);       // média espacial
      for (let ci = 0; ci < C; ci++) {
        let s = 0; for (let k = 0; k < NC; k++) s += x[ci][k];
        pool[ci] = s / NC;
      }
      const h = densa(cat(pool, globais(obs)), l.Wg, l.bg, l.c + globais(obs).length, l.g, 'tanh');
      out[NHEX] = densa(h, l.Wpass, l.bpass, l.g, 1, 'none')[0];
      const valor = l.Wv ? densa(h, l.Wv, l.bv, l.g, 1, 'none')[0] : null;
      return { logits: out, valor };
    }

    function gnnLayer(x, l, fin) {
      const out = new Array(NHEX);
      for (let h = 0; h < NHEX; h++) {
        const viz = VIZ[h], nv = viz.length;
        const msg = new Float32Array(2 * fin);
        for (let f = 0; f < fin; f++) msg[f] = x[h][f];
        if (nv) for (const j of viz) { const xj = x[j]; for (let f = 0; f < fin; f++) msg[fin + f] += xj[f]; }
        if (nv) for (let f = 0; f < fin; f++) msg[fin + f] /= nv;
        out[h] = densa(msg, l.W, l.b, 2 * fin, l.fout, l.act);
      }
      return out;
    }

    function gnnHeads(x, F, l, obs) {
      const out = new Float32Array(NA);
      for (let h = 0; h < NHEX; h++) {
        let s = l.bhex[0]; const xh = x[h];
        for (let f = 0; f < F; f++) s += l.Whex[f] * xh[f];
        out[h] = s;
      }
      const pool = new Float32Array(F);
      for (let h = 0; h < NHEX; h++) { const xh = x[h]; for (let f = 0; f < F; f++) pool[f] += xh[f]; }
      for (let f = 0; f < F; f++) pool[f] /= NHEX;
      const hh = densa(cat(pool, globais(obs)), l.Wg, l.bg, l.f + globais(obs).length, l.g, 'tanh');
      out[NHEX] = densa(hh, l.Wpass, l.bpass, l.g, 1, 'none')[0];
      const valor = l.Wv ? densa(hh, l.Wv, l.bv, l.g, 1, 'none')[0] : null;
      return { logits: out, valor };
    }

    return {
      forward,
      logits: (obs) => forward(obs).logits,
      valor: (obs) => forward(obs).valor,
    };
  }

  function cat(a, b) {
    const y = new Float32Array(a.length + b.length);
    y.set(a, 0); y.set(b, a.length);
    return y;
  }

  // ação greedy entre as casas legais
  function decidir(modelo, obs, mask) {
    const lg = modelo.logits(obs);
    let melhor = YK.RL.ACAO_PASSAR, bv = -Infinity;
    for (let a = 0; a < mask.length; a++)
      if (mask[a] && lg[a] > bv) { bv = lg[a]; melhor = a; }
    return melhor;
  }

  async function jogarFase(state, onPasso) {
    const f = YK.faseAtual(state);
    if (f.kind === 'resolve') {
      await YK.resolverTudo(state, (cb, lado) => YK.decisorAuto(state, cb, lado));
      return;
    }
    const ent = modelos[f.side];
    if (!ent) { await YK.IA.jogarFase(state, onPasso); return; }   // sem modelo: heurística
    const m = ent.m;
    let fila = YK.RL.montarFila(state, f.side);
    let guarda = 0;
    while (fila.length && guarda++ < 500) {
      const d = fila[0];
      const mask = YK.RL.mascaraDecisao(state, d);
      const acao = YK.RL.temAcaoReal(mask)
        ? decidir(m, YK.RL.observar(state, d.lado), mask)
        : YK.RL.ACAO_PASSAR;
      const houveAcao = acao !== YK.RL.ACAO_PASSAR;
      registra(state, d, acao);
      const { resto } = YK.RL.aplicarDecisao(state, d, acao);
      fila.shift();
      if (resto) fila.unshift(resto);
      if (onPasso && houveAcao) await onPasso();   // pausa só em ações visíveis
    }
  }

  function registra(state, d, acao) {
    if (acao === YK.RL.ACAO_PASSAR) return;
    const u = YK.RL.unidade(state, d.uid);
    if (!u) return;
    const destino = YK.RL.HEXES[acao], nome = YK.nomeUnidade(u);
    if (d.tipo === 'entrada') YK.log(state, `${nome} entra no tabuleiro por ${destino}.`);
    else if (d.tipo === 'mover' || d.tipo === 'moverResto') {
      if (u.hex !== destino) YK.log(state, `${nome} move-se de ${u.hex} para ${destino}.`);
    } else {
      const papel = d.tipo === 'barragem' ? 'barragem' : 'cobertura';
      YK.log(state, `${nome} apoia o combate em ${destino} (${papel}).`);
    }
  }

  // logits crus de um lado para uma observação (prior do MCTS)
  function logitsDe(lado, obs) {
    const ent = modelos[lado];
    return ent ? ent.m.logits(obs) : null;
  }
  // valor (crítico) de um lado para uma observação — avaliação de folha do PUCT
  function valorDe(lado, obs) {
    const ent = modelos[lado];
    return ent ? ent.m.valor(obs) : null;
  }

  // exposto para o teste de paridade (Node) e para a busca PUCT (ai-mcts.js)
  YK.IANeural = { carregar, compilar, definir, carregado, jogarFase, compilaSpec, compilaLegado, logitsDe, valorDe };
})(typeof window !== 'undefined' ? window : globalThis);
