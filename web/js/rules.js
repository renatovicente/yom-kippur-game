// Motor de regras — A Guerra do Yom Kippur
(function (G) {
  G.YK = G.YK || {};
  const YK = G.YK;

  // ---------- Grade hexagonal (flat-top, colunas pares deslocadas p/ baixo) ----------
  function parse(h) { return [parseInt(h.slice(0, 2), 10), parseInt(h.slice(2), 10)]; }
  function hid(c, r) { return String(c).padStart(2, '0') + String(r).padStart(2, '0'); }
  function valido(h) { return !!YK.MAP.terrain[h]; }

  function vizinhos(h) {
    const [c, r] = parse(h);
    const ns = (c % 2 === 1)
      ? [[c, r - 1], [c, r + 1], [c - 1, r - 1], [c - 1, r], [c + 1, r - 1], [c + 1, r]]
      : [[c, r - 1], [c, r + 1], [c - 1, r], [c - 1, r + 1], [c + 1, r], [c + 1, r + 1]];
    return ns.map(([a, b]) => hid(a, b)).filter(valido);
  }

  // distância em hexágonos (coordenadas cúbicas, odd-q com pares p/ baixo)
  function cubo(h) {
    const [c, r] = parse(h);
    const q = c - 1, row = r - 1;
    const z = row - (q - (q & 1)) / 2;
    return [q, -q - z, z];
  }
  function dist(a, b) {
    const A = cubo(a), B = cubo(b);
    return (Math.abs(A[0] - B[0]) + Math.abs(A[1] - B[1]) + Math.abs(A[2] - B[2])) / 2;
  }

  // ---------- Canal de Suez ----------
  // o canal contorna Ismaília pelo sudeste e entra no Lago Tinsah: as casas
  // 1203-1207 (leste do lago) pertencem à margem do Sinai
  const EXC_LESTE = new Set(YK.MAP.eastExceptions || []);
  function oeste(h) { return parse(h)[0] <= 12 && !EXC_LESTE.has(h); }
  function arestaCanal(a, b) { return oeste(a) !== oeste(b); }
  function ehAgua(h) { return YK.MAP.terrain[h] === 'agua'; }

  const PONTE_ISMAILIA = YK.MAP.bridgeIsmailia; // ['1202','1303']
  function ehPonteIsmailia(a, b) {
    return (a === PONTE_ISMAILIA[0] && b === PONTE_ISMAILIA[1]) ||
           (a === PONTE_ISMAILIA[1] && b === PONTE_ISMAILIA[0]);
  }

  // arestas d'água intransponíveis entre casas de terra (ex.: braço do Tinsah 1107|1206)
  const AGUA_EDGES = new Set((YK.MAP.aguaEdges || []).map(e => e.slice().sort().join('|')));
  function arestaAgua(a, b) {
    return AGUA_EDGES.has(a < b ? a + '|' + b : b + '|' + a);
  }

  // a casa `n` pode ser pisada vindo de `h`? casas de água só por ponte (estrada)
  function passavel(h, n) {
    if (arestaAgua(h, n)) return false;
    if (ehAgua(n)) return arestaEstrada(h, n); // ponte rodoviária sobre a água
    return true;
  }

  // hexágonos elegíveis p/ ponte de engenharia: margem leste, adjacente a terra da
  // margem oeste, sem hexágono de lago adjacente (2.2.15)
  function elegivelPonte(h) {
    if (oeste(h) || ehAgua(h)) return false;
    const ns = vizinhos(h);
    if (ns.some(ehAgua)) return false;
    return ns.some(n => oeste(n) && !ehAgua(n));
  }

  function pontesEng(state) {
    // hexágono da unidade de engenharia israelense, se a ponte estiver instalada
    const eng = state.units.find(u => u.side === 'ISR' && u.tipo === 'eng' && !u.dead && u.hex);
    if (eng && elegivelPonte(eng.hex)) return eng.hex;
    return null;
  }

  // a aresta (a,b) sobre o canal pode ser atravessada por `side`?
  function podeCruzarCanal(state, a, b, side) {
    if (!arestaCanal(a, b)) return true;
    if (ehPonteIsmailia(a, b)) return true; // ambos os lados
    if (side === 'ISR') {
      const ph = pontesEng(state);
      if (ph && (a === ph || b === ph)) {
        const w = oeste(a) ? a : b;
        // a ponte liga o hexágono da engenharia às casas adjacentes da outra margem
        return vizinhos(ph).includes(w) || w === a || w === b;
      }
    }
    return false;
  }

  // ---------- Estradas e canal de água doce ----------
  const ROADSET = new Set(YK.MAP.roads.map(e => e[0] + '|' + e[1]));
  function arestaEstrada(a, b) {
    const k = a < b ? a + '|' + b : b + '|' + a;
    return ROADSET.has(k);
  }
  // canal de água doce: feature de ARESTA — atravessá-la custa +3, salvo por ponte
  const FRESH_EDGES = new Set((YK.MAP.freshEdges || []).map(e => e[0] + '|' + e[1]));
  function arestaAguaDoce(a, b) {
    return FRESH_EDGES.has(a < b ? a + '|' + b : b + '|' + a);
  }
  const ROADHEX = new Set();
  for (const [a, b] of YK.MAP.roads) { ROADHEX.add(a); ROADHEX.add(b); }

  const CUSTO = { acidentado: 4, bosque: 3, dunas: 3, cidade: 1, aberto: 2 };

  // custo de entrar em `to` vindo de `from`
  function custoEntrada(state, side, from, to) {
    const ph = (side === 'ISR') ? pontesEng(state) : null;
    if (ph && to === ph) return 1; // passagem pela ponte de engenharia (2.2.16)
    if (arestaEstrada(from, to)) return 1; // estradas cruzam o canal por pontes
    let c = CUSTO[YK.MAP.terrain[to]];
    if (c === undefined) return Infinity;
    if (arestaAguaDoce(from, to)) c += 3; // travessia do canal de água doce
    return c;
  }

  // ---------- Ocupação e zonas de engajamento ----------
  function unidadeEm(state, h) {
    return state.units.find(u => !u.dead && u.hex === h) || null;
  }
  function temZOC(u) { return u.tipo !== 'sam'; }

  // hexágonos na ZOC do lado inimigo de `side`
  function zocInimiga(state, side) {
    const z = new Set();
    for (const u of state.units) {
      if (u.dead || !u.hex || u.side === side || !temZOC(u)) continue;
      for (const n of vizinhos(u.hex)) z.add(n);
    }
    return z;
  }

  function engajada(state, u) {
    if (!u.hex || u.tipo === 'sam') return false;
    return vizinhos(u.hex).some(n => {
      const o = unidadeEm(state, n);
      return o && o.side !== u.side && o.tipo !== 'sam' &&
             podeEngajar(state, u.hex, n);
    });
  }
  // ZOC atravessa o canal (3.3); a única exceção não existe aqui pois lagos são hexágonos
  function podeEngajar(_state, _a, _b) { return true; }

  // pares engajados (a unidade `u` está engajada com quais inimigos?)
  function inimigosAdjacentes(state, u) {
    return vizinhos(u.hex)
      .map(n => unidadeEm(state, n))
      .filter(o => o && o.side !== u.side && o.tipo !== 'sam');
  }

  // ---------- Movimentação (Dijkstra com paradas por ZOC) ----------
  // devolve Map destino -> {custo, caminho:[...]}
  function alcance(state, u, budgetOverride) {
    const res = new Map();
    if (!u.hex || u.dead || u.tipo === 'sam') return res;
    if (engajada(state, u)) return res; // engajada não se move (2.2.18/3.2)
    const budget = budgetOverride !== undefined ? budgetOverride : YK.imAtual(u);
    const zoc = zocInimiga(state, u.side);
    const dist0 = new Map([[u.hex, 0]]);
    const prev = new Map();
    const pq = [[0, u.hex]];
    while (pq.length) {
      pq.sort((x, y) => x[0] - y[0]);
      const [d, h] = pq.shift();
      if (d > (dist0.get(h) ?? Infinity)) continue;
      if (h !== u.hex && zoc.has(h)) continue; // entrou em ZOC inimiga: para
      for (const n of vizinhos(h)) {
        if (!passavel(h, n)) continue;
        if (u.tipo === 'eng' && arestaCanal(h, n)) continue; // engenharia não cruza o canal (2.2.17)
        if (!podeCruzarCanal(state, h, n, u.side)) continue;
        const occ = unidadeEm(state, n);
        if (occ) {
          if (occ.side !== u.side) {
            // israelense pode atravessar/ocupar casa de SAM (elimina a SAM)
            if (!(u.side === 'ISR' && occ.tipo === 'sam')) continue;
          }
          // amiga: pode atravessar, não pode parar (tratado abaixo)
        }
        const c = d + custoEntrada(state, u.side, h, n);
        if (c > budget) continue;
        if (c < (dist0.get(n) ?? Infinity)) {
          dist0.set(n, c); prev.set(n, h);
          pq.push([c, n]);
        }
      }
    }
    for (const [h, c] of dist0) {
      if (h === u.hex) continue;
      const occ = unidadeEm(state, h);
      if (occ && !(u.side === 'ISR' && occ.tipo === 'sam')) continue; // não pode parar sobre outra
      const caminho = [h];
      let p = h;
      while (prev.has(p)) { p = prev.get(p); caminho.unshift(p); }
      res.set(h, { custo: c, caminho });
    }
    return res;
  }

  // executa o movimento (já validado por `alcance`)
  function mover(state, u, destino, caminho) {
    // SAMs israelenses: qualquer SAM em casa ocupada ou atravessada é eliminada
    if (u.side === 'ISR' && caminho) {
      for (const h of caminho) {
        const o = unidadeEm(state, h);
        if (o && o.side === 'EGY' && o.tipo === 'sam') {
          o.dead = true; o.hex = null;
          log(state, `SAM egípcia destruída em ${h} pela passagem israelense.`);
        }
      }
    }
    u.hex = destino;
    u.movedRound = state.round;
  }

  // ---------- Combate ----------
  // coluna da Tabela de Relação de Forças (4.5.3)
  function colunaRelacao(atq, def) {
    if (atq * 2 <= def) return -2;
    if (atq < def) return -1;
    if (atq < def * 2) return 0;
    if (atq < def * 3) return 1;
    return 2;
  }

  // Tabela de Efeitos de Combate (2d6 x coluna): [defensor, atacante]
  const TEC = {
    '-2': { 2:'DVI-AE',3:'DVI-AE',4:'DVB-AE',5:'DVI-AE',6:'DVB-ARB',7:'DVI-ARB',8:'DVI-ARI',9:'DVI-ARB',10:'DRI-AVB',11:'DRI-AVB',12:'DRB-AVB' },
    '-1': { 2:'DVI-AE',3:'DVB-AE',4:'DVB-AE',5:'DVB-ARB',6:'DVB-ARI',7:'DVB-ARB',8:'DVB-ARI',9:'DRB-AVB',10:'DRI-AVB',11:'DRB-AVB',12:'DE-AVB' },
    '0':  { 2:'DE-AVI',3:'DE-AVB',4:'DVI-ARI',5:'DRB-AVB',6:'DVB-ARI',7:'DRI-AVI',8:'DRI-AVB',9:'DVB-ARB',10:'DVI-ARI',11:'DVB-AE',12:'DVI-AE' },
    '1':  { 2:'DE-AVI',3:'DE-AVB',4:'DE-AVB',5:'DRB-AVB',6:'DRI-AVB',7:'DRB-AVB',8:'DRI-AVB',9:'DVB-ARB',10:'DVB-ARI',11:'DVB-ARB',12:'DVB-AE' },
    '2':  { 2:'DE-AVI',3:'DE-AVI',4:'DE-AVB',5:'DE-AVI',6:'DRB-AVB',7:'DRB-AVI',8:'DRI-AVI',9:'DRB-AVI',10:'DVB-ARI',11:'DVB-ARI',12:'DVB-ARB' },
  };

  // ---------- valor esperado exato do combate (expectimax sobre a CRT 2d6) ----------
  // utilidade de cada efeito na perspectiva do ATACANTE: queremos o defensor mal
  // (eliminado/recuado) e a nós mesmos bem (intactos/avançando).
  const UTIL_DEF = { DE: 1.0, DRB: 0.6, DRI: 0.4, DVB: -0.1, DVI: -0.2 };
  const UTIL_ATQ = { AE: -1.0, ARB: -0.6, ARI: -0.3, AVB: 0.5, AVI: 0.7 };
  // distribuição de 2d6 (somas 2..12), pesos sobre 36
  const PESO_2D6 = { 2:1,3:2,4:3,5:4,6:5,7:6,8:5,9:4,10:3,11:2,12:1 };
  // valor esperado por coluna, pré-computado uma vez
  const EV_COLUNA = {};
  for (const col of ['-2','-1','0','1','2']) {
    let ev = 0;
    for (let d = 2; d <= 12; d++) {
      const [efD, efA] = TEC[col][d].split('-');
      ev += (PESO_2D6[d] / 36) * (UTIL_DEF[efD] + UTIL_ATQ[efA]);
    }
    EV_COLUNA[col] = ev;
  }
  // valor esperado (atacante) de um combate dada a coluna de relação de forças
  function valorEsperadoColuna(col) { return EV_COLUNA[String(col)]; }
  // idem a partir dos totais já somados
  function valorEsperadoCombate(atq, def) { return EV_COLUNA[String(colunaRelacao(atq, def))]; }

  const BONUS_DEF = { acidentado: 2, bosque: 2, dunas: 2, cidade: 1, aberto: 0 };
  function bonusTerreno(h) {
    if (ROADHEX.has(h)) return 0; // estrada anula o terreno na defesa
    return BONUS_DEF[YK.MAP.terrain[h]] || 0;
  }

  // combates obrigatórios = componentes conexos do grafo de engajamento (4.1.5)
  function combates(state, ladoAtacante) {
    const engA = state.units.filter(u => u.side === ladoAtacante && !u.dead && u.hex &&
      u.tipo !== 'sam' && engajada(state, u));
    const visitados = new Set();
    const comps = [];
    for (const a of engA) {
      if (visitados.has(a.id)) continue;
      const A = new Set(), D = new Set();
      const fila = [a];
      visitados.add(a.id);
      while (fila.length) {
        const u = fila.pop();
        if (u.side === ladoAtacante) {
          A.add(u);
          for (const o of inimigosAdjacentes(state, u))
            if (!D.has(o)) { D.add(o); fila.push(o); }
        } else {
          D.add(u);
          for (const o of inimigosAdjacentes(state, u))
            if (o.side === ladoAtacante && !visitados.has(o.id)) { visitados.add(o.id); A.add(o); fila.push(o); }
        }
      }
      comps.push({ atacantes: [...A], defensores: [...D], barragem: [], cobertura: [] });
    }
    return comps;
  }

  // artilharias que podem apoiar à distância um combate (4.2)
  // tanto a barragem (ataque) quanto a cobertura (defesa) miram as casas atacadas
  function ehArtilharia(u) { return u.tipo === 'art' || u.tipo === 'artm' || u.tipo === 'rocket'; }
  function artilhariasDisponiveis(state, side, combate) {
    return state.units.filter(u =>
      u.side === side && !u.dead && u.hex && ehArtilharia(u) &&
      u.fired !== state.round && !engajada(state, u) &&
      !combate.atacantes.includes(u) && !combate.defensores.includes(u) &&
      combate.defensores.some(d => dist(u.hex, d.hex) <= u.alcance));
  }

  function totaisCombate(state, cb) {
    // defensores estão sempre em combate direto (adjacentes), logo recebem terreno;
    // artilharia em barragem/cobertura soma apenas o IC, sem terreno (4.5.10)
    const atq = cb.atacantes.reduce((s, u) => s + YK.icAtual(u), 0) +
                cb.barragem.reduce((s, u) => s + YK.icAtual(u), 0);
    const def = cb.defensores.reduce((s, u) => s + YK.icAtual(u) + bonusTerreno(u.hex), 0) +
                cb.cobertura.reduce((s, u) => s + YK.icAtual(u), 0);
    return { atq, def };
  }

  function rolarDados(rng) {
    return (1 + Math.floor(rng() * 6)) + (1 + Math.floor(rng() * 6));
  }

  // ---------- Recuo, baixas, eliminação ----------
  function sofrerBaixas(state, u) {
    if (u.baixas) { eliminar(state, u, 'baixas pela 2ª vez'); return; }
    u.baixas = 1;
    log(state, `${YK.nomeUnidade(u)} em ${u.hex} sofre baixas (vira o verso).`);
  }
  function eliminar(state, u, motivo) {
    log(state, `${YK.nomeUnidade(u)} eliminada${u.hex ? ' em ' + u.hex : ''} (${motivo}).`);
    u.dead = true;
    // engenharia israelense pode retornar (4.3.2)
    if (u.side === 'ISR' && u.tipo === 'eng') {
      u.dead = false; u.hex = null; u.baixas = 0; u.entrada = state.round + 1; u.retornando = true;
      log(state, 'A engenharia poderá retornar pela casa 2505 na rodada seguinte.');
    } else {
      u.hex = null;
    }
  }

  // escolha obrigatória: quem já tem baixas sofre primeiro (4.5.9)
  function candidatosBaixa(unidades) {
    const feridas = unidades.filter(u => u.baixas);
    return feridas.length ? feridas : unidades;
  }

  // casas válidas de recuo para `u` (1 casa, fora de ZOC inimiga)
  function casasRecuo(state, u, profundidade) {
    if (u.dead || !u.hex) return { livres: [], deslocaveis: [] };
    profundidade = profundidade || 0;
    const zoc = zocInimiga(state, u.side);
    const livres = [], deslocaveis = [];
    for (const n of vizinhos(u.hex)) {
      if (!passavel(u.hex, n)) continue;
      if (u.tipo === 'eng' && arestaCanal(u.hex, n)) continue; // 2.2.17
      if (!podeCruzarCanal(state, u.hex, n, u.side)) continue;
      if (zoc.has(n)) continue;
      const occ = unidadeEm(state, n);
      if (!occ) livres.push(n);
      else if (occ.side === u.side && occ.tipo !== 'sam' && profundidade < 4) deslocaveis.push(n);
    }
    return { livres, deslocaveis };
  }

  // recua `u` 1 casa; devolve true se conseguiu, false se eliminada
  function recuar(state, u, escolhaHex, profundidade) {
    // a unidade pode ter sido eliminada por um recuo em cadeia anterior do
    // mesmo combate (o chamador itera sobre um snapshot da lista)
    if (u.dead || !u.hex) return false;
    profundidade = profundidade || 0;
    const { livres, deslocaveis } = casasRecuo(state, u, profundidade);
    let destino = null;
    if (escolhaHex && (livres.includes(escolhaHex) || deslocaveis.includes(escolhaHex)))
      destino = escolhaHex;
    else if (livres.length) destino = melhorRecuo(state, u, livres);
    else if (deslocaveis.length) destino = melhorRecuo(state, u, deslocaveis);
    if (!destino) {
      // caso especial: israelense pode recuar 2 casas pela ponte de engenharia
      if (u.side === 'ISR') {
        const ph = pontesEng(state);
        if (ph && vizinhos(u.hex).includes(ph)) {
          const zoc = zocInimiga(state, u.side);
          const alvo = vizinhos(ph).find(n => oeste(n) && !ehAgua(n) && !unidadeEm(state, n) && !zoc.has(n));
          if (alvo) {
            log(state, `${YK.nomeUnidade(u)} recua 2 casas pela ponte de engenharia para ${alvo}.`);
            u.hex = alvo;
            return true;
          }
        }
      }
      eliminar(state, u, 'recuo impossível');
      return false;
    }
    const occ = unidadeEm(state, destino);
    if (occ) {
      // deslocamento em cadeia de unidade amiga (regra de recuo)
      if (!recuar(state, occ, null, profundidade + 1)) {
        eliminar(state, u, 'recuo impossível');
        return false;
      }
      log(state, `${YK.nomeUnidade(occ)} deslocada em cadeia.`);
    }
    log(state, `${YK.nomeUnidade(u)} recua de ${u.hex} para ${destino}.`);
    u.hex = destino;
    return true;
  }

  function melhorRecuo(state, u, opcoes) {
    // heurística: afastar-se do inimigo mais próximo; preferir terreno defensivo
    const inimigos = state.units.filter(o => !o.dead && o.hex && o.side !== u.side && o.tipo !== 'sam');
    let best = null, bs = -1e9;
    for (const h of opcoes) {
      let dmin = 99;
      for (const o of inimigos) dmin = Math.min(dmin, dist(h, o.hex));
      const s = dmin * 10 + bonusTerreno(h) - (unidadeEm(state, h) ? 5 : 0);
      if (s > bs) { bs = s; best = h; }
    }
    return best;
  }

  // ---------- Resolução de um combate ----------
  // `decisor` permite injetar escolhas (humano/IA); funções podem ser assíncronas
  async function resolverCombate(state, cb, rng, decisor) {
    const { atq, def } = totaisCombate(state, cb);
    const col = colunaRelacao(atq, def);
    const dados = rolarDados(rng);
    const resultado = TEC[String(col)][dados];
    const [efD, efA] = resultado.split('-');
    log(state, `Combate: ataque ${atq} x defesa ${def} → coluna ${col > 0 ? '+' + col : col === 0 ? '=' : col}; dados ${dados} → ${resultado}.`);
    for (const a of [...cb.barragem, ...cb.cobertura]) a.fired = state.round;

    const casasDef = cb.defensores.map(d => d.hex);
    const vivosD = () => cb.defensores.filter(x => !x.dead && x.hex);
    const vivosA = () => cb.atacantes.filter(x => !x.dead && x.hex);

    // ----- efeitos sobre o defensor (sempre primeiro, 4.5.6) -----
    if (efD === 'DE') {
      const cand = vivosD();
      const alvo = await decisor.escolherEliminada('DEF', cand);
      eliminar(state, alvo, 'resultado DE');
      for (const d of vivosD()) recuar(state, d, await decisor.escolherRecuo('DEF', d));
    } else if (efD === 'DRB' || efD === 'DRI') {
      if (efD === 'DRB') {
        const cand = candidatosBaixa(vivosD());
        sofrerBaixas(state, await decisor.escolherBaixa('DEF', cand));
      }
      for (const d of vivosD()) recuar(state, d, await decisor.escolherRecuo('DEF', d));
    } else if (efD === 'DVB') {
      const cand = candidatosBaixa(vivosD());
      sofrerBaixas(state, await decisor.escolherBaixa('DEF', cand));
    } // DVI: nada

    // ----- efeitos sobre o atacante -----
    if (efA === 'AE') {
      const cand = vivosA();
      if (cand.length) {
        const alvo = await decisor.escolherEliminada('ATQ', cand);
        eliminar(state, alvo, 'resultado AE');
      }
      for (const a of vivosA()) recuar(state, a, await decisor.escolherRecuo('ATQ', a));
    } else if (efA === 'ARB' || efA === 'ARI') {
      if (efA === 'ARB') {
        const cand = candidatosBaixa(vivosA());
        if (cand.length) sofrerBaixas(state, await decisor.escolherBaixa('ATQ', cand));
      }
      for (const a of vivosA()) recuar(state, a, await decisor.escolherRecuo('ATQ', a));
    } else if (efA === 'AVB' || efA === 'AVI') {
      if (efA === 'AVB') {
        const cand = candidatosBaixa(vivosA());
        if (cand.length) sofrerBaixas(state, await decisor.escolherBaixa('ATQ', cand));
      }
      // avanço opcional para casas desocupadas (ignora ZOC)
      const vagas = casasDef.filter(h => !unidadeEm(state, h));
      if (vagas.length) await decisor.avancar(cb, vagas);
    }
    return { atq, def, col, dados, resultado };
  }

  // ---------- Vitória (7.x) ----------
  function controla(state, h, side) {
    const occ = unidadeEm(state, h);
    if (occ && occ.tipo !== 'sam') return occ.side === side;
    let s = false, o = false;
    for (const n of vizinhos(h)) {
      const u = unidadeEm(state, n);
      if (u && u.tipo !== 'sam') { if (u.side === side) s = true; else o = true; }
    }
    return s && !o;
  }

  function objetivosIsraelenses(state) {
    const sams = state.units.filter(u => u.tipo === 'sam');
    const samsOK = sams.every(s => {
      if (s.dead) return true;
      // capturada: israelense mais próxima dela do que qualquer egípcia (7.2)
      const dISR = Math.min(...state.units.filter(u => u.side === 'ISR' && !u.dead && u.hex).map(u => dist(u.hex, s.hex)), 99);
      const dEGY = Math.min(...state.units.filter(u => u.side === 'EGY' && !u.dead && u.hex && u.tipo !== 'sam').map(u => dist(u.hex, s.hex)), 99);
      return dISR < dEGY;
    });
    const ismailia = controla(state, '0803', 'ISR') && controla(state, '1202', 'ISR');
    const fahid = controla(state, '0621', 'ISR') || controla(state, '0722', 'ISR');
    return { samsOK, ismailia, fahid, total: (samsOK ? 1 : 0) + (ismailia ? 1 : 0) + (fahid ? 1 : 0) };
  }

  function estradaLivre(state) {
    // existe caminho de estrada Fahid (0621/0722) → Ismaília (0803/1202)
    // sem unidade israelense sobre as casas do caminho?
    const bloqueio = new Set(state.units.filter(u => u.side === 'ISR' && !u.dead && u.hex).map(u => u.hex));
    const adj = {};
    for (const [a, b] of YK.MAP.roads) {
      (adj[a] = adj[a] || []).push(b);
      (adj[b] = adj[b] || []).push(a);
    }
    const inicio = ['0621', '0722'].filter(h => !bloqueio.has(h));
    const metas = new Set(['0803', '1202']);
    const vis = new Set(inicio);
    const fila = [...inicio];
    while (fila.length) {
      const h = fila.shift();
      if (metas.has(h)) return true;
      for (const n of (adj[h] || [])) {
        if (!vis.has(n) && !bloqueio.has(n)) { vis.add(n); fila.push(n); }
      }
    }
    return false;
  }

  function avaliarVitoria(state) {
    const obj = objetivosIsraelenses(state);
    const isrPerdidas = state.units.filter(u => u.side === 'ISR' && u.dead).length;
    const isrOeste = state.units.filter(u => u.side === 'ISR' && !u.dead && u.hex && oeste(u.hex)).length;
    if (obj.total === 3) return { vencedor: 'ISR', tipo: 'decisiva', obj };
    if (isrPerdidas > isrOeste) return { vencedor: 'EGY', tipo: 'decisiva', obj };
    if (obj.total === 2) return { vencedor: 'ISR', tipo: 'parcial', obj };
    if (obj.total === 0 && estradaLivre(state)) return { vencedor: 'EGY', tipo: 'parcial', obj };
    if (obj.total === 1) return { vencedor: 'ISR', tipo: 'marginal', obj };
    if (obj.total === 0) return { vencedor: 'EGY', tipo: 'marginal', obj };
    return { vencedor: null, tipo: 'empate', obj };
  }

  function log(state, msg) {
    if (state._sim) return;          // estados de simulação (MCTS) não logam
    state.log.push(`[R${state.round}] ${msg}`);
    if (YK.onLog) YK.onLog(msg);
  }

  Object.assign(YK, {
    parse, hid, valido, vizinhos, dist, oeste, arestaCanal, ehAgua,
    ehPonteIsmailia, elegivelPonte, pontesEng, podeCruzarCanal,
    arestaAgua, passavel,
    arestaEstrada, custoEntrada, unidadeEm, zocInimiga, engajada,
    inimigosAdjacentes, alcance, mover, colunaRelacao, TEC, bonusTerreno,
    valorEsperadoColuna, valorEsperadoCombate,
    combates, totaisCombate, rolarDados, sofrerBaixas, eliminar,
    candidatosBaixa, casasRecuo, recuar, resolverCombate, controla,
    ehArtilharia, artilhariasDisponiveis,
    objetivosIsraelenses, estradaLivre, avaliarVitoria, log, ROADHEX, arestaAguaDoce,
  });
})(typeof window !== 'undefined' ? window : globalThis);
