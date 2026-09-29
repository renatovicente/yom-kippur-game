// IA heurística — joga qualquer um dos lados
(function (G) {
  G.YK = G.YK || {};
  const YK = G.YK;

  // objetivos fixos
  const OBJ_ISR = ['0803', '1202', '0621', '0722'];
  const SAM_HEXES = () => ['0211', '0216', '0121'];

  // PESOS da heurística, POR LADO. Os padrões reproduzem exatamente a heurística
  // original (qualquer mudança aqui muda o OPONENTE de todas as avaliações — ver
  // RL.md: ligar o expectimax em junho moveu o MLP da Fase A de 87% para 14%).
  // Ajustáveis por YK.IA.setPesos(lado, {...}) — usado pela otimização CEM.
  //   dist/alvo      atração por alvos (−dist·d, +alvo se ocupar o alvo)
  //   expectimax,ev  engajamento por valor esperado exato da CRT (×ev); senão pesos fixos
  //   apoioEngaja    penalidade p/ artilharia/engenharia engajar
  //   exposicao,expRazao  penalidade se IC inimigo (raio 3) > expRazao×(amigo+próprio)
  //   terreno,inercia,custo,artDist  termos menores
  //   ponte*         (ISR) escolha da casa da ponte: +ponteInimigo·dist ao inimigo mais
  //                  próximo − ponteEng·dist da engenharia − ponteObj·dist aos objetivos
  //   guardaPonte    (ISR) nº de unidades de combate que ficam coladas à engenharia
  //                  depois da ponte (0 = todas partem para os objetivos, original)
  //   cacaRaio       (EGY) só caçam a engenharia na ponte as unidades a ≤ raio (∞ = todas)
  const PESOS_PADRAO = {
    dist: 10, alvo: 80, expectimax: true, ev: 65, apoioEngaja: 80,
    exposicao: 30, expRazao: 2, terreno: 2, inercia: 1, custo: 0.01, artDist: 6,
    ponteInimigo: 1, ponteEng: 0, ponteObj: 0, ponteLinhaMin: 8, ponteLinhaMax: 16,
    guardaPonte: 0, cacaRaio: Infinity,
  };
  const PESOS = { ISR: { ...PESOS_PADRAO }, EGY: { ...PESOS_PADRAO } };
  function setPesos(lado, p) { Object.assign(PESOS[lado], p); }
  function getPesos(lado) { return { ...PESOS[lado] }; }
  function resetPesos() { PESOS.ISR = { ...PESOS_PADRAO }; PESOS.EGY = { ...PESOS_PADRAO }; }

  // gancho de MACRO-AÇÕES (ai-macro.js): uma função (state,u)->[hexes] que
  // substitui os alvos de uma unidade. Permite que um plano de alto nível
  // redirecione o executor de baixo nível (a movimentação heurística) sem duplicar
  // pathfinding/pontuação. Null = doutrina padrão.
  let _alvosOverride = null;

  function unidadesVivas(state, side) {
    return state.units.filter(u => !u.dead && u.hex && u.side === side && u.tipo !== 'sam');
  }
  function inimigas(state, side) {
    return state.units.filter(u => !u.dead && u.hex && u.side !== side && u.tipo !== 'sam');
  }

  // estima a coluna de odds se `extra` unidades amigas ficarem adjacentes ao grupo inimigo em `hexAlvo`
  function estimarColuna(state, side, hexDest, novaIC) {
    // inimigos que ficariam engajados conosco em hexDest
    const adversarios = YK.vizinhos(hexDest)
      .map(h => YK.unidadeEm(state, h))
      .filter(u => u && u.side !== side && u.tipo !== 'sam');
    if (!adversarios.length) return null;
    let atq = novaIC;
    // amigos já adjacentes a esses inimigos somam no mesmo combate
    const amigos = new Set();
    for (const o of adversarios) {
      for (const n of YK.vizinhos(o.hex)) {
        const a = YK.unidadeEm(state, n);
        if (a && a.side === side && a.tipo !== 'sam') amigos.add(a);
      }
    }
    for (const a of amigos) atq += YK.icAtual(a);
    let def = 0;
    for (const o of adversarios) def += YK.icAtual(o) + YK.bonusTerreno(o.hex);
    return YK.colunaRelacao(atq, def);
  }

  // distância simplificada até o objetivo mais próximo de uma lista
  function distMin(h, alvos) {
    let m = 999;
    for (const a of alvos) m = Math.min(m, YK.dist(h, a));
    return m;
  }

  // ---------- fase de movimentação ----------
  // onPasso (opcional): chamado após cada ação aplicada, p/ a UI renderizar e
  // pausar no modo passo a passo
  async function moverIA(state, side, onPasso, jaMovidas) {
    jaMovidas = jaMovidas || null;   // Set de ids a pular (usado pelo rollout do MCTS)
    const unidades = unidadesVivas(state, side)
      .filter(u => !YK.engajada(state, u) && !(jaMovidas && jaMovidas.has(u.id)));
    // ordem: engenharia primeiro (ISR), depois tanques, transportes, infantaria, artilharia
    const ordem = { eng: 0, tank: 1, htank: 1, transp: 2, inf: 3, rocket: 4, art: 4, artm: 4 };
    unidades.sort((a, b) => ordem[a.tipo] - ordem[b.tipo]);

    // entradas (reforços / unidades iniciais fora do tabuleiro)
    for (const u of YK.poolEntrada(state, side)) {
      if (jaMovidas && jaMovidas.has(u.id)) continue;
      const casas = YK.casasEntrada(state, u);
      if (!casas.length) continue;
      // escolhe a casa de entrada mais próxima do objetivo
      const alvos = alvosDe(state, u);
      casas.sort((a, b) => distMin(a, alvos) - distMin(b, alvos));
      const r = YK.entrarUnidade(state, u, casas[0]);
      if (r.ok && r.im > 0) moverUnidade(state, u, r.im);
      if (onPasso) await onPasso();
    }
    for (const u of unidades) {
      moverUnidade(state, u);
      if (onPasso) await onPasso();
    }
  }

  function alvosDe(state, u) {
    if (_alvosOverride) {
      const r = _alvosOverride(state, u);
      if (r && r.length) return r;   // plano define os alvos; senão cai na doutrina
    }
    if (u.side === 'ISR') {
      const eng = state.units.find(x => x.side === 'ISR' && x.tipo === 'eng' && !x.dead && x.hex);
      if (u.tipo === 'eng') {
        // já está numa casa elegível? fica (mover desfaz a ponte)
        if (u.hex && YK.elegivelPonte(u.hex)) return [u.hex];
        // melhor casa elegível para a ponte (padrão: a mais longe do inimigo)
        const P = PESOS.ISR;
        const cand = [];
        for (let r = P.ponteLinhaMin; r <= P.ponteLinhaMax; r++) {
          const h = YK.hid(13, r);
          if (YK.valido(h) && YK.elegivelPonte(h) && !YK.unidadeEm(state, h)) cand.push(h);
        }
        if (cand.length) {
          const inim = inimigas(state, 'ISR');
          const nota = h => P.ponteInimigo * Math.min(...inim.map(o => YK.dist(h, o.hex)), 99)
            - (P.ponteEng && u.hex ? P.ponteEng * YK.dist(u.hex, h) : 0)
            - (P.ponteObj ? P.ponteObj * distMin(h, OBJ_ISR) : 0);
          cand.sort((a, b) => nota(b) - nota(a));
          return [cand[0]];
        }
        return ['1310'];
      }
      if (YK.ehArtilharia(u)) {
        // ficar a (alcance-1) do inimigo mais próximo do grosso das forças
        const inim = inimigas(state, 'ISR');
        if (inim.length) return inim.map(o => o.hex);
        return ['1503'];
      }
      // resgate: se a engenharia está engajada, atacar quem a prende
      if (eng && YK.engajada(state, eng)) {
        return YK.inimigosAdjacentes(state, eng).map(o => o.hex);
      }
      // antes da ponte: escoltar a engenharia até o canal
      if (!state.ponteRodada && eng) {
        const alvoEng = YK.elegivelPonte(eng.hex) ? eng.hex : alvosDe(state, eng)[0];
        return [alvoEng, eng.hex];
      }
      // depois da ponte: as `guardaPonte` unidades de combate mais próximas ficam
      // coladas à engenharia (a ponte some se ela morrer — é o alvo nº 1 do Egito)
      const G = Math.round(PESOS.ISR.guardaPonte);
      if (G > 0 && eng && u.hex && YK.elegivelPonte(eng.hex)) {
        const comb = unidadesVivas(state, 'ISR')
          .filter(x => x.tipo !== 'eng' && !YK.ehArtilharia(x))
          .sort((a, b) => (YK.dist(a.hex, eng.hex) - YK.dist(b.hex, eng.hex)) || (a.id < b.id ? -1 : 1));
        if (comb.slice(0, G).includes(u)) return [eng.hex];
      }
      // depois: objetivos a oeste + SAMs
      const sams = state.units.filter(s => s.tipo === 'sam' && !s.dead).map(s => s.hex);
      const objetivos = [...OBJ_ISR, ...sams];
      const pendentes = objetivos.filter(h => !YK.controla(state, h, 'ISR'));
      return pendentes.length ? pendentes : objetivos;
    } else {
      // Egito: defender entradas das cidades, SAMs e a linha do canal
      const isr = inimigas(state, 'EGY');
      const defesa = ['0803', '1202', '0621', '0722', ...SAM_HEXES()];
      // a ponte israelense é alvo prioritário: eliminar a engenharia a desfaz
      const eng = state.units.find(x => x.side === 'ISR' && x.tipo === 'eng' && !x.dead && x.hex);
      if (eng && YK.elegivelPonte(eng.hex)) {
        const R = PESOS.EGY.cacaRaio;
        if (!(R < Infinity) || !u.hex || YK.dist(u.hex, eng.hex) <= R) return [eng.hex];
      }
      if (!isr.length) return defesa;
      // guarnição: quem já está num objetivo de defesa não o abandona
      if (defesa.includes(u.hex)) return [u.hex];
      // demais: todos os objetivos + posições inimigas — cada unidade vai ao
      // alvo mais próximo (garante guarnições E contenção, sem migração em massa)
      return [...defesa, ...isr.map(o => o.hex)];
    }
  }

  // pontua TODOS os lances de movimento de `u` (inclui ficar parado, h = u.hex).
  // Fonte única da decisão heurística: moverUnidade escolhe o máximo; a busca
  // PUCT usa estas notas como candidatos/prior (ai-mcts, prior 'heuristica'/'uniao').
  function avaliarLances(state, u, budgetOverride) {
    const opcoes = YK.alcance(state, u, budgetOverride);
    const alvos = alvosDe(state, u);
    const zoc = YK.zocInimiga(state, u.side);
    const minha = YK.icAtual(u);
    const W = PESOS[u.side];
    const lista = [{ h: u.hex, info: null, s: pontuar(state, u, u.hex, alvos, zoc, minha, true) }];
    for (const [h, info] of opcoes)
      lista.push({ h, info, s: pontuar(state, u, h, alvos, zoc, minha, false) - info.custo * W.custo });
    return lista;
  }

  // o lance que a heurística faria (1º máximo estrito; u.hex = ficar parado)
  function melhorLance(lista) {
    let melhor = lista[0];
    for (let i = 1; i < lista.length; i++) if (lista[i].s > melhor.s) melhor = lista[i];
    return melhor;
  }
  function lanceHeuristico(state, u, budgetOverride) {
    return melhorLance(avaliarLances(state, u, budgetOverride)).h;
  }
  // casas de entrada ordenadas pela heurística (a 1ª é a escolhida)
  function entradasHeuristicas(state, u) {
    const alvos = alvosDe(state, u);
    return YK.casasEntrada(state, u).slice()
      .sort((a, b) => distMin(a, alvos) - distMin(b, alvos))
      .map(h => ({ h, s: -distMin(h, alvos) * PESOS[u.side].dist }));
  }

  function moverUnidade(state, u, budgetOverride) {
    const lista = avaliarLances(state, u, budgetOverride);
    if (lista.length === 1) return;                 // sem lances além de ficar
    const melhor = melhorLance(lista);
    if (melhor.info) {
      YK.log(state, `${YK.nomeUnidade(u)} move-se de ${u.hex} para ${melhor.h}.`);
      YK.mover(state, u, melhor.h, melhor.info.caminho);
    }
  }

  function pontuar(state, u, h, alvos, zoc, minhaIC, ficarParado) {
    const W = PESOS[u.side];
    let s = -distMin(h, alvos) * W.dist;
    const ehArt = YK.ehArtilharia(u);
    const engajaria = zoc.has(h) || YK.vizinhos(h).some(n => {
      const o = YK.unidadeEm(state, n);
      return o && o.side !== u.side && o.tipo !== 'sam';
    });
    if (engajaria) {
      // ficaria engajada: ataque obrigatório na nossa fase
      const col = estimarColuna(state, u.side, h, minhaIC);
      if (col !== null) {
        if (ehArt || u.tipo === 'eng') s -= W.apoioEngaja;  // apoio não deve engajar
        else if (W.expectimax) {
          // valor esperado exato do combate (distribuição 2d6) — menos míope que
          // pesos fixos: pondera baixas/recuos prováveis dos dois lados
          s += W.ev * YK.valorEsperadoColuna(col);
        } else if (col >= 2) s += 70;            // (heurística antiga: pesos fixos)
        else if (col === 1) s += 35;
        else if (col === 0) s -= 25;
        else s -= 100;
      }
    } else if (ehArt) {
      // artilharia: ideal ficar a alcance-1 do inimigo mais próximo
      const inim = inimigas(state, u.side);
      if (inim.length) {
        const d = Math.min(...inim.map(o => YK.dist(h, o.hex)));
        s += -Math.abs(d - (u.alcance - 1)) * W.artDist;
      }
    }
    // exposição: muito inimigo perto e poucos amigos = perigo na fase deles
    let icInimigo = 0, icAmigo = 0;
    for (const o of state.units) {
      if (o.dead || !o.hex || o === u || o.tipo === 'sam') continue;
      const d = YK.dist(h, o.hex);
      if (d <= 3) {
        if (o.side === u.side) icAmigo += YK.icAtual(o);
        else icInimigo += YK.icAtual(o);
      }
    }
    if (icInimigo > (icAmigo + minhaIC) * W.expRazao) s -= W.exposicao;
    // objetivo ocupado vale muito
    if (alvos.includes(h)) s += W.alvo;
    // terreno defensivo conta um pouco
    s += YK.bonusTerreno(h) * W.terreno;
    // pequena inércia para não dançar à toa
    if (ficarParado) s += W.inercia;
    return s;
  }

  // ---------- fase de ataque: alocar barragens ----------
  async function alocarBarragens(state, side, onPasso) {
    for (const cb of state.combats) {
      const { atq, def } = YK.totaisCombate(state, cb);
      let col = YK.colunaRelacao(atq, def);
      if (col >= 2) continue;
      const arts = YK.artilhariasDisponiveis(state, side, cb)
        .filter(a => !state.combats.some(c2 => c2.barragem.includes(a)));
      for (const a of arts) {
        const novo = YK.colunaRelacao(atq + cb.barragem.reduce((s, x) => s + YK.icAtual(x), 0) + YK.icAtual(a), def);
        if (novo > col) {
          cb.barragem.push(a);
          col = novo;
          YK.log(state, `${YK.nomeUnidade(a)} apoia o ataque com fogo de barragem.`);
          if (onPasso) await onPasso();
        }
        if (col >= 2) break;
      }
    }
  }

  // ---------- fase de cobertura: artilharia defensiva ----------
  async function alocarCobertura(state, ladoDefensor, onPasso) {
    // combates ordenados pela pior situação do defensor
    const cbs = state.combats.slice().sort((a, b) => {
      const ta = YK.totaisCombate(state, a), tb = YK.totaisCombate(state, b);
      return YK.colunaRelacao(tb.atq, tb.def) - YK.colunaRelacao(ta.atq, ta.def);
    });
    for (const cb of cbs) {
      const arts = YK.artilhariasDisponiveis(state, ladoDefensor, cb)
        .filter(a => !state.combats.some(c2 => c2.cobertura.includes(a) || c2.barragem.includes(a)));
      for (const a of arts) {
        const t = YK.totaisCombate(state, cb);
        const col = YK.colunaRelacao(t.atq, t.def);
        if (col <= -1) break; // já está bom para o defensor
        const novo = YK.colunaRelacao(t.atq, t.def + YK.icAtual(a));
        if (novo < col) {
          cb.cobertura.push(a);
          YK.log(state, `${YK.nomeUnidade(a)} dá fogo de cobertura à defesa.`);
          if (onPasso) await onPasso();
        }
      }
    }
  }

  // joga a fase atual inteira (para lados controlados pela IA)
  async function jogarFase(state, onPasso) {
    const f = YK.faseAtual(state);
    if (f.kind === 'mov') {
      await moverIA(state, f.side, onPasso);
    } else if (f.kind === 'ataque') {
      YK.prepararAtaques(state);
      await alocarBarragens(state, f.side, onPasso);
    } else if (f.kind === 'cobertura') {
      await alocarCobertura(state, f.side, onPasso);
    } else if (f.kind === 'resolve') {
      await YK.resolverTudo(state, (cb, lado) => YK.decisorAuto(state, cb, lado));
    }
  }

  // executa uma fase de MOVIMENTO sob um plano (override de alvos); restaura ao fim
  async function moverComPlano(state, side, plano, jaMovidas) {
    const ant = _alvosOverride;
    _alvosOverride = plano || null;
    try { await moverIA(state, side, null, jaMovidas); }
    finally { _alvosOverride = ant; }
  }

  YK.IA = { jogarFase, moverIA, moverComPlano, alocarBarragens, alocarCobertura,
            estimarColuna, OBJ_ISR, SAM_HEXES,
            avaliarLances, lanceHeuristico, entradasHeuristicas,
            PESOS_PADRAO, setPesos, getPesos, resetPesos,
            // compat: liga/desliga o expectimax dos DOIS lados
            usarExpectimax: (v) => { PESOS.ISR.expectimax = v; PESOS.EGY.expectimax = v; } };
})(typeof window !== 'undefined' ? window : globalThis);
