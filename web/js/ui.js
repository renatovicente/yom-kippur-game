// Interface — A Guerra do Yom Kippur
(function (G) {
  const YK = G.YK;
  const SVGNS = 'http://www.w3.org/2000/svg';

  // ---------- geometria do tabuleiro (flat-top) ----------
  const S = 30;                    // lado do hexágono
  const DX = 1.5 * S;              // espaçamento entre colunas
  const DY = Math.sqrt(3) * S;     // espaçamento entre linhas
  const OX = 60, OY = 50;

  function centro(h) {
    const [c, r] = YK.parse(h);
    const x = OX + (c - 1) * DX;
    const y = OY + (r - 1) * DY + (c % 2 === 0 ? DY / 2 : 0);
    return [x, y];
  }
  function poligono(h) {
    const [x, y] = centro(h);
    const p = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 180 * (60 * i);
      p.push((x + S * Math.cos(a)).toFixed(1) + ',' + (y + S * Math.sin(a)).toFixed(1));
    }
    return p.join(' ');
  }

  // ---------- estado da interface ----------
  let state = null;
  let selecionada = null;      // unidade selecionada p/ mover
  let alcanceAtual = null;     // Map destino -> info
  let entradaPendente = null;  // unidade do pool aguardando casa de entrada
  let movidas = new Set();     // unidades que já moveram nesta fase
  let rodando = false;         // trava reentrância de IA

  const $ = id => document.getElementById(id);

  // helpers de DOM (sem innerHTML)
  function elx(tag, cls, txt) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  }
  function linhas(container, ...textos) {
    container.replaceChildren();
    for (const t of textos) {
      if (t === null || t === undefined || t === '') continue;
      container.append(elx('div', '', t));
    }
  }

  // ---------- desenho estático do tabuleiro ----------
  function desenharTabuleiro() {
    const svg = $('board');
    svg.replaceChildren();
    const W = OX * 2 + 24 * DX + S, H = OY * 2 + 22 * DY;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);

    const gHex = el('g'), gFeat = el('g'), gUnits = el('g');
    gUnits.id = 'gUnits';
    svg.append(gHex, gFeat, gUnits);

    for (const h of Object.keys(YK.MAP.terrain)) {
      const t = YK.MAP.terrain[h];
      const pol = el('polygon');
      pol.setAttribute('points', poligono(h));
      pol.setAttribute('class', 'hex ' + t);
      pol.dataset.hex = h;
      pol.addEventListener('click', () => clicarHex(h));
      pol.addEventListener('mouseenter', () => mostrarInfo(h));
      gHex.append(pol);
      const [x, y] = centro(h);
      const lb = el('text');
      lb.setAttribute('x', x); lb.setAttribute('y', y - S * 0.62);
      lb.setAttribute('text-anchor', 'middle');
      lb.setAttribute('class', 'hexlabel');
      lb.textContent = h;
      gHex.append(lb);
      if (t === 'cidade') {
        // quarteirões pretos espalhados, como no tabuleiro original
        // (pseudoaleatório determinístico semeado pelo número da casa)
        let semente = parseInt(h, 10) * 2654435761 % 2147483647;
        const rnd = () => {
          semente = (semente * 48271) % 2147483647;
          return semente / 2147483647;
        };
        for (let i = 0; i < 11; i++) {
          const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * S * 0.62;
          const bw = 3.5 + rnd() * 5.5, bh = 2.5 + rnd() * 3.5;
          const bx = x + Math.cos(a) * d, by = y + Math.sin(a) * d;
          if (Math.abs(by - y + 9) < 4 && i % 3 === 0) continue; // poupa o rótulo
          const r = el('rect');
          r.setAttribute('x', (bx - bw / 2).toFixed(1));
          r.setAttribute('y', (by - bh / 2).toFixed(1));
          r.setAttribute('width', bw.toFixed(1)); r.setAttribute('height', bh.toFixed(1));
          if (rnd() > 0.7) r.setAttribute('transform', `rotate(${(rnd() * 40 - 20).toFixed(0)} ${bx.toFixed(1)} ${by.toFixed(1)})`);
          r.setAttribute('class', 'cidadePts');
          gFeat.append(r);
        }
      }
    }

    // canal de água doce: corre SEMPRE pelos LADOS dos hexágonos, vértice a
    // vértice, seguindo as cadeias de arestas extraídas do mapa original
    const extremosAresta = ([a, b]) => {
      // os dois vértices da aresta compartilhada = ponto médio ± perpendicular·S/2
      const [xa, ya] = centro(a), [xb, yb] = centro(b);
      const mx = (xa + xb) / 2, my = (ya + yb) / 2;
      let px = -(yb - ya), py = (xb - xa);
      const L = Math.hypot(px, py) || 1;
      px = px / L * S / 2; py = py / L * S / 2;
      return [[mx - px, my - py], [mx + px, my + py]];
    };
    const mesmoPonto = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1;
    function caminhoCurso(arestas) {
      const pts = [];
      let [u0, v0] = extremosAresta(arestas[0]);
      if (arestas.length > 1) {
        const [u1, v1] = extremosAresta(arestas[1]);
        // começa pelo vértice que NÃO conecta à aresta seguinte
        const conecta = mesmoPonto(v0, u1) || mesmoPonto(v0, v1);
        pts.push(conecta ? u0 : v0, conecta ? v0 : u0);
      } else {
        pts.push(u0, v0);
      }
      for (let i = 1; i < arestas.length; i++) {
        const [u, v] = extremosAresta(arestas[i]);
        const ult = pts[pts.length - 1];
        if (mesmoPonto(u, ult)) pts.push(v);
        else if (mesmoPonto(v, ult)) pts.push(u);
        else pts.push(u, v); // descontinuidade inesperada: liga mesmo assim
      }
      return pts;
    }
    const CURSOS = YK.MAP.freshCourses || {};
    for (const [nome, arestas] of Object.entries(CURSOS)) {
      // sem prolongamentos: os cursos terminam nos limites dos hexágonos
      const pts = caminhoCurso(arestas);
      const c = el('path');
      c.setAttribute('d', 'M ' + pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L '));
      c.setAttribute('class', 'aguadoce');
      gFeat.append(c);
    }

    // estradas: cadeias contínuas suavizadas, reproduzindo as curvas do original
    const adjE = {};
    for (const [a, b] of YK.MAP.roads) {
      (adjE[a] = adjE[a] || []).push(b);
      (adjE[b] = adjE[b] || []).push(a);
    }
    const ek = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
    const visitadoE = new Set();
    const cadeias = [];
    for (const n of Object.keys(adjE)) {
      if (adjE[n].length === 2) continue; // cadeias começam em pontas ou junções
      for (const v of adjE[n]) {
        if (visitadoE.has(ek(n, v))) continue;
        visitadoE.add(ek(n, v));
        const cadeia = [n, v];
        let prev = n, cur = v;
        while (adjE[cur].length === 2) {
          const nx = adjE[cur].find(x => x !== prev);
          if (!nx || visitadoE.has(ek(cur, nx))) break;
          visitadoE.add(ek(cur, nx));
          cadeia.push(nx);
          prev = cur; cur = nx;
        }
        cadeias.push(cadeia);
      }
    }
    for (const cadeia of cadeias) {
      // a estrada cruza o braço d'água em linha reta sobre a ponte da aresta
      // 1108|1207 — o centro de 1108 sai do traçado para a reta 1107→1208
      // (sem prolongamentos além dos limites dos hexágonos do tabuleiro)
      const pts = cadeia.filter(h => h !== '1108').map(h => centro(h));
      const p = el('path');
      p.setAttribute('d', caminhoSuave(pts));
      p.setAttribute('class', 'estrada');
      gFeat.append(p);
    }

    // Canal de Suez: percorre os LADOS dos hexágonos (mesma técnica dos cursos
    // de água doce), no tom azul dos lagos
    const suezNorte = [
      ['1201', '1301'], ['1201', '1302'], ['1202', '1302'],
      ['1202', '1303'],                                 // ponte de Ismaília
      ['1202', '1203'],                                 // contorna a cidade
    ];
    const suezSul = [
      ['1107', '1206'], ['1107', '1207'], ['1108', '1207'], ['1207', '1208'],
      ['1208', '1308'], ['1208', '1309'], ['1209', '1309'], ['1209', '1310'],
      ['1210', '1310'], ['1210', '1311'], ['1211', '1311'], ['1211', '1312'],
      ['1212', '1312'], ['1212', '1313'], ['1213', '1313'], ['1213', '1314'],
      ['1214', '1314'], ['1214', '1315'], ['1215', '1315'], ['1215', '1316'],
      ['1216', '1316'],
    ];
    {
      const ptsN = caminhoCurso(suezNorte);
      ptsN.push(centro('1103'), centro('1104'));        // deságua no Lago Tinsah
      const ptsS = caminhoCurso(suezSul);
      ptsS.unshift(centro('1106'));                     // sai do Tinsah
      ptsS.push(centro('1317'));                        // deságua no Grande Lago Amargo
      for (const pts of [ptsN, ptsS]) {
        const p = el('path');
        p.setAttribute('d', 'M ' + pts.map(q => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' L '));
        p.setAttribute('class', 'canalSuez');
        gFeat.append(p);
      }
    }
    // pontes sobre a água: Ismaília (1202-1303) e a ponte rodoviária sobre a
    // aresta 1108|1207 — a reta 1107→1208 cruza exatamente o meio dessa aresta
    desenharPonte(gFeat, centro('1202'), centro('1303'));
    desenharPonte(gFeat, centro('1107'), centro('1208'));
    // pontes do canal de água doce: toda aresta em que a estrada cruza o curso
    // verde ganha o símbolo (ex.: 0303|0304 e 0503|0504)
    for (const [a, b] of (YK.MAP.freshEdges || [])) {
      if (YK.arestaEstrada(a, b)) desenharPonte(gFeat, centro(a), centro(b));
    }

    // rótulos geográficos e saídas
    for (const [nome, h] of Object.entries(YK.MAP.labels)) {
      if (!YK.MAP.terrain[h]) continue;
      rotulo(gFeat, h, nome, 4);
    }
    rotulo(gFeat, '0114', '← Cairo', -S * 0.8);
    rotulo(gFeat, '2505', 'Jerusalém →', -S * 0.8);
  }
  // curva suave (Catmull-Rom → cúbicas de Bézier) pelos pontos dados
  function caminhoSuave(pts) {
    if (pts.length < 3) return 'M ' + pts.map(p => p.map(v => v.toFixed(1)).join(' ')).join(' L ');
    let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1],
            p3 = pts[Math.min(pts.length - 1, i + 2)];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    return d;
  }

  // símbolo de ponte: dois traços paralelos à travessia, um de cada lado
  function desenharPonte(g, a, b) {
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L;        // direção da travessia
    const px = -uy, py = ux;               // perpendicular
    for (const lado of [-1, 1]) {
      const p = el('path');
      const ox = px * 7 * lado, oy = py * 7 * lado;
      p.setAttribute('d',
        `M ${mx - ux * 9 + ox - px * 3 * lado} ${my - uy * 9 + oy - py * 3 * lado} ` +
        `L ${mx - ux * 6 + ox} ${my - uy * 6 + oy} ` +
        `L ${mx + ux * 6 + ox} ${my + uy * 6 + oy} ` +
        `L ${mx + ux * 9 + ox - px * 3 * lado} ${my + uy * 9 + oy - py * 3 * lado}`);
      p.setAttribute('class', 'ponte');
      g.append(p);
    }
  }

  function rotulo(g, h, txt, dy) {
    const [x, y] = centro(h);
    const t = el('text');
    t.setAttribute('x', x); t.setAttribute('y', y + dy);
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('class', 'maplabel');
    t.textContent = txt;
    g.append(t);
  }
  function el(tag) { return document.createElementNS(SVGNS, tag); }

  // contorno hexagonal sobre uma casa, para marcar participantes de um combate
  function marcaHexCombate(g, hex, classe) {
    const p = el('polygon');
    p.setAttribute('points', poligono(hex));
    p.setAttribute('class', 'combHex ' + classe);
    g.append(p);
  }

  // ---------- silhuetas das peças (reproduzem a Identificação das Peças) ----------
  function silhueta(tipo, x, y) {
    const g = el('g');
    const fill = d => { const p = el('path'); p.setAttribute('d', d); p.setAttribute('class', 'silf'); g.append(p); };
    const traco = d => { const p = el('path'); p.setAttribute('d', d); p.setAttribute('class', 'sil'); g.append(p); };
    const circ = (cx, cy, r) => { const c = el('circle'); c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', r); c.setAttribute('class', 'silf'); g.append(c); };
    let esc = 1;
    switch (tipo) {
      case 'tank': case 'htank':
        // tanque de perfil, canhão longo para a esquerda
        fill('M -10 1 H 10 Q 11 1 10 4 L 7.5 6 H -7.5 L -10 4 Q -11 2.5 -10 1 Z ' +
             'M -5 1 L -3.5 -2.5 H 4.5 L 6.5 1 Z ' +
             'M -16 -1.9 H -3.5 V -0.5 H -16 Z');
        break;
      case 'transp':
        // transporte blindado: casco em barco com torre baixa e cano curto
        fill('M -11 1 L -7.5 -3 H 8 L 11 1 L 7.5 4.8 H -7.5 Z ' +
             'M -3 -3 L -2 -5.6 H 2.4 L 3.4 -3 Z ' +
             'M -8.2 -5.2 H -2 V -4 H -8.2 Z');
        break;
      case 'art':
        // artilharia: superestrutura alta, cano curto à esquerda
        fill('M -10 2 H 10 Q 11 2 10 4.5 L 7.5 6 H -7.5 L -10 4.5 Z ' +
             'M -6.5 2 L -5.5 -1.8 H -0.5 L 0.5 -4.2 H 8 L 9.2 2 Z ' +
             'M -14.5 -1.6 H -5 V -0.1 H -14.5 Z');
        break;
      case 'artm':
        // artilharia automotiva: cano longo inclinado para a direita
        fill('M -10.5 2 H 9.5 L 7 6 H -7.5 Z ' +
             'M -9.5 2 L -8.5 -3.2 H 0 L 2.2 -1 L 3.2 2 Z ' +
             'M 0.5 -2 L 15 -4.4 L 15 -3 L 1.5 -0.4 Z');
        break;
      case 'rocket':
        // foguete terra-terra sobre rampa inclinada
        fill('M -12 -7.6 L 11 2.2 L 10.5 3.6 L -12.5 -6.2 Z M 7.5 1.8 L 12.5 4.4 L 12 5.4 L 7 2.9 Z');
        circ(-0.5, 0.6, 3.4);
        fill('M -7.5 -6.4 L -1.5 -3.3 L -2.6 -1.2 L -8.6 -4.3 Z');
        break;
      case 'sam':
        // bomba/míssil apontando para a direita, empenas à esquerda
        fill('M -4 0 Q -4 -3.9 2 -3.9 Q 11.2 -3.9 12.8 0 Q 11.2 3.9 2 3.9 Q -4 3.9 -4 0 Z ' +
             'M -3 -1.6 L -9.6 -5.8 L -6.4 0 L -9.6 5.8 L -3 1.6 Z');
        break;
      case 'inf':
        // soldado em pé com fuzil em diagonal
        esc = 0.78;
        fill('M -2.7 -8.3 Q -2.7 -11.2 0 -11.2 Q 2.7 -11.2 2.7 -8.3 L 3.1 -8 L -3.1 -8 Z ' + // capacete
             'M -2.4 -7.8 H 2.4 L 2.1 0.2 H -2.1 Z ' +                                       // tronco
             'M -2.1 0 L -3.7 7.8 H -1.4 L 0 2.2 L 1.4 7.8 H 3.7 L 2.1 0 Z ' +               // pernas
             'M -5.2 3.2 L 6.6 -8.9 L 7.8 -7.7 L -4 4.4 Z');                                  // fuzil
        break;
      case 'eng':
        // símbolo de ponte )( como no original
        traco('M -2 -7 Q -5.5 -5.5 -5.5 0 Q -5.5 5.5 -2 7');
        traco('M 2 -7 Q 5.5 -5.5 5.5 0 Q 5.5 5.5 2 7');
        traco('M -2 -7 L -3.5 -8 M -2 7 L -3.5 8 M 2 -7 L 3.5 -8 M 2 7 L 3.5 8');
        break;
    }
    g.setAttribute('transform', `translate(${x},${y})` + (esc !== 1 ? ` scale(${esc})` : ''));
    return g;
  }

  // ---------- desenho dinâmico (unidades, destaques) ----------
  function render() {
    const g = $('gUnits');
    g.replaceChildren();
    document.querySelectorAll('.hex').forEach(p =>
      p.classList.remove('alcancavel', 'alvoEntrada', 'selecionada', 'opcao'));

    for (const u of state.units) {
      if (u.dead || !u.hex) continue;
      const [x, y] = centro(u.hex);
      const gu = el('g');
      gu.setAttribute('class',
        'unidade ' + (u.side === 'EGY' ? 'egy' : 'isr') +
        (u.baixas ? ' baixas' : '') +
        (selecionada === u ? ' sel' : '') +
        (u.tipo !== 'sam' && YK.engajada(state, u) ? ' engajada' : '') +
        (YK.ehArtilharia(u) && u.fired === state.round ? ' artUsada' : ''));
      const r = el('rect');
      r.setAttribute('x', x - 16); r.setAttribute('y', y - 15);
      r.setAttribute('width', 32); r.setAttribute('height', 30);
      r.setAttribute('rx', 3);
      r.setAttribute('class', 'corpo');
      gu.append(r);
      gu.append(silhueta(u.tipo, x, y - 5));
      if (u.tipo !== 'sam') {
        const t = el('text');
        t.setAttribute('x', x); t.setAttribute('y', y + 12);
        t.setAttribute('text-anchor', 'middle');
        t.textContent = `${YK.icAtual(u)}-${YK.imAtual(u)}`;
        gu.append(t);
        if (u.alcance) {
          const a = el('text');
          a.setAttribute('x', x + 13); a.setAttribute('y', y - 6);
          a.setAttribute('text-anchor', 'end');
          a.textContent = u.alcance;
          gu.append(a);
        }
      }
      gu.addEventListener('click', ev => { ev.stopPropagation(); clicarUnidade(u); });
      gu.addEventListener('mouseenter', () => mostrarInfoUnidade(u));
      g.append(gu);
    }

    // ponte de engenharia ativa
    const ph = YK.pontesEng(state);
    if (ph) {
      const [x, y] = centro(ph);
      const t = el('text');
      t.setAttribute('x', x); t.setAttribute('y', y - S * 0.8);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('class', 'maplabel');
      t.textContent = '⛩ ponte';
      g.append(t);
    }

    // destaques de movimento
    if (alcanceAtual) {
      for (const [h, info] of alcanceAtual) {
        const pol = document.querySelector(`.hex[data-hex="${h}"]`);
        if (pol) pol.classList.add('alcancavel');
        const [x, y] = centro(h);
        const t = el('text');
        t.setAttribute('x', x); t.setAttribute('y', y + S * 0.55);
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('class', 'custoTag');
        t.textContent = info.custo;
        g.append(t);
      }
      if (selecionada && selecionada.hex) {
        const pol = document.querySelector(`.hex[data-hex="${selecionada.hex}"]`);
        if (pol) pol.classList.add('selecionada');
      }
    }
    if (entradaPendente) {
      for (const h of YK.casasEntrada(state, entradaPendente)) {
        const pol = document.querySelector(`.hex[data-hex="${h}"]`);
        if (pol) pol.classList.add('alvoEntrada');
      }
    }

    // destaque dos COMBATES no tabuleiro (fases de ataque/cobertura/resolução):
    // contorna atacantes e defensores e liga-os por uma seta; numera cada combate
    const fCmb = YK.faseAtual(state);
    if ((fCmb.kind === 'ataque' || fCmb.kind === 'cobertura' || fCmb.kind === 'resolve')
        && state.combats && state.combats.length) {
      state.combats.forEach((cb, i) => {
        const atk = cb.atacantes.filter(u => !u.dead && u.hex);
        const def = cb.defensores.filter(u => !u.dead && u.hex);
        if (!atk.length || !def.length) return;
        for (const u of atk) marcaHexCombate(g, u.hex, 'combAtq');
        for (const u of def) marcaHexCombate(g, u.hex, 'combDef');
        for (const u of [...cb.barragem, ...cb.cobertura])
          if (u.hex) marcaHexCombate(g, u.hex, 'combArt');
        // setas atacante → defensor
        for (const a of atk) for (const d of def) {
          const [xa, ya] = centro(a.hex), [xb, yb] = centro(d.hex);
          const ln = el('line');
          ln.setAttribute('x1', xa); ln.setAttribute('y1', ya);
          ln.setAttribute('x2', xb); ln.setAttribute('y2', yb);
          ln.setAttribute('class', 'combLinha');
          g.append(ln);
        }
        // número do combate sobre o primeiro defensor
        const [dx, dy] = centro(def[0].hex);
        const badge = el('circle');
        badge.setAttribute('cx', dx + S * 0.55); badge.setAttribute('cy', dy - S * 0.55);
        badge.setAttribute('r', 8); badge.setAttribute('class', 'combBadge');
        g.append(badge);
        const num = el('text');
        num.setAttribute('x', dx + S * 0.55); num.setAttribute('y', dy - S * 0.55 + 3.5);
        num.setAttribute('text-anchor', 'middle'); num.setAttribute('class', 'combNum');
        num.textContent = i + 1;
        g.append(num);
      });
    }

    renderHeader();
    renderPool();
    renderCombates();
    renderLog();
  }

  function renderHeader() {
    const f = YK.faseAtual(state);
    $('faseBanner').textContent = `Rodada ${state.round} de 6 — ${f.titulo}` +
      (ehHumano(f.side) ? '' : state.modos[f.side] === 'neural' ? ' (IA Neural)'
        : state.modos[f.side] === 'mcts' ? ' (IA Busca)' : ' (IA)');
    const rd = $('rodadas');
    rd.replaceChildren();
    for (let i = 1; i <= 6; i++) {
      const s = elx('span', i === state.round ? 'atual' : '', String(i));
      rd.append(s);
    }
  }

  function renderLog() {
    const lg = $('log');
    lg.replaceChildren();
    for (const l of state.log.slice(-80)) lg.append(elx('p', '', l));
    lg.scrollTop = lg.scrollHeight;
  }

  function placaUnidade(u, sel) {
    const d = elx('span',
      'uplaca' + (u.side === 'ISR' ? ' isr' : '') + (u.baixas ? ' baixas' : '') + (sel ? ' sel' : ''),
      `${YK.TIPOS[u.tipo].nome}` +
      (u.tipo === 'sam' ? '' : ` ${YK.icAtual(u)}-${YK.imAtual(u)}`) +
      (u.alcance ? ` ⌖${u.alcance}` : ''));
    return d;
  }

  function renderPool() {
    const f = YK.faseAtual(state);
    const box = $('poolBox');
    if (f.kind !== 'mov' || !ehHumano(f.side)) { box.classList.add('hidden'); return; }
    const pool = YK.poolEntrada(state, f.side).filter(u => !movidas.has(u.id));
    const div = $('pool');
    div.replaceChildren();
    box.classList.toggle('hidden', pool.length === 0);
    for (const u of pool) {
      const p = placaUnidade(u, entradaPendente === u);
      p.addEventListener('click', () => {
        entradaPendente = entradaPendente === u ? null : u;
        selecionada = null; alcanceAtual = null;
        render();
        if (entradaPendente) instruir('Clique numa casa de entrada destacada no tabuleiro.');
      });
      div.append(p);
    }
    const fora = state.units.filter(u => !u.dead && !u.hex && u.side === f.side &&
      !YK.poolEntrada(state, f.side).includes(u)).length;
    if (fora) div.append(elx('p', '', `${fora} reforço(s) ainda indisponível(is).`));
  }

  function renderCombates() {
    const f = YK.faseAtual(state);
    const box = $('combatesBox');
    const mostrar = (f.kind === 'ataque' || f.kind === 'cobertura' || f.kind === 'resolve') && state.combats.length;
    box.classList.toggle('hidden', !mostrar);
    if (!mostrar) return;
    const div = $('combates');
    div.replaceChildren();
    state.combats.forEach((cb, i) => {
      const d = elx('div', 'combate');
      const { atq, def } = YK.totaisCombate(state, cb);
      const col = YK.colunaRelacao(atq, def);
      d.append(elx('b', '', `Combate ${i + 1}`));
      d.append(elx('div', '', `${cb.atacantes.map(a => a.hex).join(', ')} ⚔ ${cb.defensores.map(x => x.hex).join(', ')}`));
      d.append(elx('div', 'odds',
        `ataque ${atq} × defesa ${def} → coluna ${col > 0 ? '+' + col : col === 0 ? '=' : col}`));
      if (cb.barragem.length) d.append(elx('div', '', `barragem: ${cb.barragem.map(a => a.hex).join(', ')}`));
      if (cb.cobertura.length) d.append(elx('div', '', `cobertura: ${cb.cobertura.map(a => a.hex).join(', ')}`));
      if ((f.kind === 'ataque' || f.kind === 'cobertura') && ehHumano(f.side)) {
        const arts = YK.artilhariasDisponiveis(state, f.side, cb)
          .filter(a => !state.combats.some(c2 => c2.barragem.includes(a) || c2.cobertura.includes(a)));
        for (const a of arts) {
          const b = elx('button', '', `+ ${YK.TIPOS[a.tipo].nome} ${a.hex} (IC ${YK.icAtual(a)})`);
          b.addEventListener('click', () => {
            (f.kind === 'ataque' ? cb.barragem : cb.cobertura).push(a);
            YK.log(state, `${YK.nomeUnidade(a)} designada para ${f.kind === 'ataque' ? 'barragem' : 'cobertura'}.`);
            render();
          });
          d.append(b);
        }
        const lista = f.kind === 'ataque' ? cb.barragem : cb.cobertura;
        if (lista.length) {
          const rm = elx('button', '', '− remover artilharia');
          rm.addEventListener('click', () => { lista.length = 0; render(); });
          d.append(rm);
        }
      }
      div.append(d);
    });
  }

  // ---------- informações ----------
  const NOMES_TERRENO = {
    aberto: 'Firme e aberto (2 pts · defesa +0)',
    dunas: 'Dunas (3 pts · defesa +2)',
    bosque: 'Bosque (3 pts · defesa +2)',
    acidentado: 'Acidentado (4 pts · defesa +2)',
    cidade: 'Cidade (1 pt · defesa +1)',
    agua: 'Lago — intransponível',
  };
  function mostrarInfo(h) {
    const t = YK.MAP.terrain[h];
    const margemCanal = YK.vizinhos(h).some(n => YK.arestaAguaDoce(h, n));
    linhas($('info'),
      `Casa ${h}`,
      NOMES_TERRENO[t],
      YK.ROADHEX.has(h) ? 'Estrada (1 pt · anula defesa do terreno)' : '',
      margemCanal ? 'Margem do canal de água doce (travessia +3 fora das pontes)' : '');
  }
  function mostrarInfoUnidade(u) {
    linhas($('info'),
      YK.nomeUnidade(u),
      `Casa ${u.hex}`,
      u.baixas ? '⚠ Com baixas (próxima baixa elimina)' : '',
      u.tipo !== 'sam' && YK.engajada(state, u) ? '🔴 Engajada em combate' : '',
      YK.ehArtilharia(u) && u.fired === state.round ? 'Artilharia já atuou nesta rodada' : '');
  }

  // ---------- interação ----------
  function ehHumano(side) { return state.modos[side] === 'humano'; }

  function clicarUnidade(u) {
    const f = YK.faseAtual(state);
    if (state.fim || rodando) return;
    if (f.kind === 'mov' && ehHumano(f.side) && u.side === f.side && u.tipo !== 'sam') {
      if (movidas.has(u.id)) { instruir('Esta unidade já se movimentou nesta fase.'); return; }
      if (YK.engajada(state, u)) { instruir('Unidade engajada não pode se movimentar (regra 3.2).'); return; }
      selecionada = (selecionada === u) ? null : u;
      entradaPendente = null;
      alcanceAtual = selecionada ? YK.alcance(state, u) : null;
      render();
      return;
    }
    mostrarInfoUnidade(u);
  }

  function clicarHex(h) {
    if (state.fim || rodando) return;
    const f = YK.faseAtual(state);
    if (f.kind !== 'mov' || !ehHumano(f.side)) return;
    if (entradaPendente) {
      const u = entradaPendente;
      if (YK.casasEntrada(state, u).includes(h)) {
        const r = YK.entrarUnidade(state, u, h);
        if (r.ok) {
          movidas.add(u.id);
          entradaPendente = null;
          if (r.im > 0 && !YK.engajada(state, u)) {
            selecionada = u;
            alcanceAtual = YK.alcance(state, u, r.im);
            movidas.delete(u.id);
            instruir(`Unidade entrou por ${h}. Pode continuar o movimento (${r.im} pts restantes).`);
          }
          render();
        }
      }
      return;
    }
    if (selecionada && alcanceAtual && alcanceAtual.has(h)) {
      const info = alcanceAtual.get(h);
      YK.mover(state, selecionada, h, info.caminho);
      movidas.add(selecionada.id);
      selecionada = null;
      alcanceAtual = null;
      render();
    }
  }

  function instruir(txt) { $('instrucao').textContent = txt; }

  const INSTRUCOES = {
    mov: 'Clique numa unidade sua e depois numa casa destacada para mover. ' +
         'Unidades fora do tabuleiro entram pelo painel ao lado. ' +
         'Quando terminar, clique em "Encerrar fase".',
    ataque: 'Os combates entre unidades engajadas são obrigatórios. ' +
            'Atribua artilharia de barragem aos combates, se desejar, e encerre a fase.',
    cobertura: 'Você é o defensor: atribua artilharia de cobertura aos combates e encerre a fase.',
    resolve: 'Clique em "Encerrar fase" para rolar os dados e aplicar os resultados.',
  };

  // ---------- fluxo de fases ----------
  async function encerrarFase() {
    if (rodando || state.fim) return;
    const f = YK.faseAtual(state);
    if (f.kind === 'resolve') {
      rodando = true;
      $('btnFase').disabled = true;
      await YK.resolverTudo(state, criarDecisor);
      $('btnFase').disabled = false;
      rodando = false;
    }
    selecionada = null; alcanceAtual = null; entradaPendente = null;
    movidas = new Set();
    YK.proximaFase(state);
    if (state.fim) { render(); mostrarFim(); return; }
    prepararFase();
  }

  async function prepararFase() {
    const f = YK.faseAtual(state);
    if (f.kind === 'ataque') YK.prepararAtaques(state);
    $('btnFase').classList.remove('destaque');
    render();
    if (!ehHumano(f.side)) {
      rodando = true;
      $('btnFase').disabled = true;
      const onPasso = passoAPasso && f.kind !== 'resolve' ? passoIA : null;
      instruir(passoAPasso ? 'A IA está jogando — clique em "Próximo movimento" para avançar.' : 'A IA está jogando…');
      mostrarControlesPasso(!!onPasso);
      await atraso(onPasso ? 50 : 300);
      const ia = state.modos[f.side] === 'neural' ? YK.IANeural
               : state.modos[f.side] === 'mcts' ? YK.IAMcts : YK.IA;
      if (f.kind === 'resolve') {
        await YK.resolverTudo(state, criarDecisor);
      } else {
        await ia.jogarFase(state, onPasso);
      }
      mostrarControlesPasso(false);
      $('btnFase').disabled = false;
      rodando = false;
      movidas = new Set();
      render();
      await atraso(passoAPasso ? 50 : 150);
      YK.proximaFase(state);
      if (state.fim) { render(); mostrarFim(); return; }
      prepararFase();
      return;
    }
    instruirFaseHumana(f);
    render();
  }

  // instrução contextual: deixa claro o papel da fase (mover / atacar / defender)
  // e destaca "Encerrar fase" quando não há ação possível (evita a sensação de
  // "travou" nas fases defensivas do 2º jogador)
  function instruirFaseHumana(f) {
    const lado = f.side === 'EGY' ? 'egípcias' : 'israelenses';
    let txt, semAcao = false;
    if (f.kind === 'mov') {
      const pool = YK.poolEntrada(state, f.side).length;
      const moveis = state.units.filter(u => u.side === f.side && !u.dead && u.hex &&
        u.tipo !== 'sam' && !YK.engajada(state, u)).length;
      if (pool + moveis === 0) {
        txt = '🟢 Sua movimentação — nenhuma unidade pode mover agora. Clique em “Encerrar fase”.';
        semAcao = true;
      } else {
        txt = `🟢 Sua movimentação (forças ${lado}). Clique numa unidade e depois numa casa destacada. ` +
          (pool ? `${pool} reforço(s) disponível(is) no painel ao lado. ` : '') +
          'Clique em “Encerrar fase” quando terminar.';
      }
    } else if (f.kind === 'ataque') {
      if (!state.combats.length) {
        txt = '⚔ Designação de ataques — você não tem unidades engajadas. Clique em “Encerrar fase”.';
        semAcao = true;
      } else {
        txt = '⚔ Seus combates (em destaque ao lado) são obrigatórios. Atribua artilharia de barragem, se quiser, e encerre a fase.';
      }
    } else if (f.kind === 'cobertura') {
      if (!state.combats.length) {
        txt = '🛡 Defesa — o inimigo não atacou nesta fase. Clique em “Encerrar fase” para seguir até a SUA movimentação.';
        semAcao = true;
      } else {
        txt = '🛡 Você está defendendo: atribua artilharia de cobertura aos combates, se quiser, e encerre a fase.';
      }
    } else { // resolve
      txt = '🎲 Clique em “Encerrar fase” para rolar os dados e resolver os combates.';
      semAcao = true;
    }
    instruir(txt);
    $('btnFase').classList.toggle('destaque', semAcao);
  }

  // ---------- passo a passo da IA ----------
  let passoAPasso = false;
  let pularFase = false;
  let resolverPasso = null;   // promessa pendente aguardando "Próximo movimento"

  // chamado pela IA após cada ação; renderiza e espera o clique (ou pula)
  function passoIA() {
    render();
    if (pularFase) return Promise.resolve();
    return new Promise(res => {
      resolverPasso = res;
      $('btnPasso').disabled = false;
    });
  }
  function mostrarControlesPasso(ativo) {
    $('passoControles').classList.toggle('hidden', !ativo);
    if (ativo) { pularFase = false; $('btnPasso').disabled = true; }
  }
  function avancarPasso() {
    if (resolverPasso) { const r = resolverPasso; resolverPasso = null; $('btnPasso').disabled = true; r(); }
  }
  function pularRestante() {
    pularFase = true;
    if (resolverPasso) { const r = resolverPasso; resolverPasso = null; r(); }
  }

  function atraso(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ---------- decisor (escolhas durante a resolução) ----------
  function ladoDe(papel, cb) {
    return papel === 'ATQ'
      ? (cb.atacantes[0] ? cb.atacantes[0].side : 'ISR')
      : (cb.defensores[0] ? cb.defensores[0].side : 'EGY');
  }

  function criarDecisor(cb, ladoAtacante) {
    const auto = YK.decisorAuto(state, cb, ladoAtacante);
    return {
      async escolherBaixa(papel, cand) {
        if (cand.length <= 1 || !ehHumano(ladoDe(papel, cb))) return auto.escolherBaixa(papel, cand);
        render();
        return modalEscolha(`Qual unidade sofre baixas? (${papel === 'ATQ' ? 'atacante' : 'defensor'})`,
          cand.map(u => ({ rotulo: `${YK.nomeUnidade(u)} — casa ${u.hex}`, valor: u })));
      },
      async escolherEliminada(papel, cand) {
        if (cand.length <= 1 || !ehHumano(ladoDe(papel, cb))) return auto.escolherEliminada(papel, cand);
        render();
        return modalEscolha(`Qual unidade é eliminada? (${papel === 'ATQ' ? 'atacante' : 'defensor'})`,
          cand.map(u => ({ rotulo: `${YK.nomeUnidade(u)} — casa ${u.hex}`, valor: u })));
      },
      async escolherRecuo(papel, u) {
        if (!ehHumano(ladoDe(papel, cb))) return null;
        const { livres, deslocaveis } = YK.casasRecuo(state, u);
        const ops = [...livres, ...deslocaveis];
        if (ops.length <= 1) return null;
        render();
        return modalEscolha(`Recuo de ${YK.nomeUnidade(u)} (casa ${u.hex}): para onde?`,
          ops.map(h => ({ rotulo: `Casa ${h}${deslocaveis.includes(h) ? ' (desloca unidade amiga)' : ''}`, valor: h })));
      },
      async avancar(combate, vagas) {
        const lado = combate.atacantes[0] ? combate.atacantes[0].side : null;
        if (!lado || !ehHumano(lado)) return auto.avancar(combate, vagas);
        const cand = combate.atacantes.filter(u => !u.dead && u.hex);
        if (!cand.length) return;
        render();
        const ops = [{ rotulo: 'Não avançar', valor: null }];
        for (const u of cand)
          for (const h of vagas)
            ops.push({ rotulo: `${YK.nomeUnidade(u)} (${u.hex}) → casa ${h}`, valor: { u, h } });
        const esc = await modalEscolha('Vitória! Avançar para a casa conquistada?', ops);
        if (esc) {
          YK.log(state, `${YK.nomeUnidade(esc.u)} avança para ${esc.h}.`);
          esc.u.hex = esc.h;
        }
      },
    };
  }

  function modalEscolha(titulo, opcoes) {
    return new Promise(resolve => {
      $('modalTitulo').textContent = titulo;
      const corpo = $('modalCorpo');
      corpo.replaceChildren();
      for (const op of opcoes) {
        const b = elx('button', '', op.rotulo);
        b.addEventListener('click', () => {
          $('modal').classList.add('hidden');
          render();
          resolve(op.valor);
        });
        corpo.append(b);
      }
      $('modal').classList.remove('hidden');
    });
  }

  // ---------- fim de jogo ----------
  function mostrarFim() {
    const f = state.fim;
    const nomes = { ISR: 'israelense', EGY: 'egípcia' };
    $('fimTitulo').textContent = f.vencedor
      ? `Vitória ${f.tipo} ${nomes[f.vencedor]}`
      : 'Fim da partida — sem vencedor';
    const o = f.obj;
    const det = $('fimDetalhe');
    det.replaceChildren();
    det.append(elx('p', '', 'Objetivos israelenses:'));
    const ul = document.createElement('ul');
    ul.append(elx('li', '', `${o.samsOK ? '✅' : '❌'} Bases SAM destruídas ou capturadas`));
    ul.append(elx('li', '', `${o.ismailia ? '✅' : '❌'} Entradas de Ismaília (0803 e 1202) controladas`));
    ul.append(elx('li', '', `${o.fahid ? '✅' : '❌'} Entrada de Fahid (0621 ou 0722) controlada`));
    det.append(ul);
    det.append(elx('p', '', `Unidades perdidas — israelenses: ` +
      `${state.units.filter(u => u.side === 'ISR' && u.dead).length} · ` +
      `egípcias: ${state.units.filter(u => u.side === 'EGY' && u.dead).length}`));
    det.append(elx('p', '', `Semente da partida: ${state.seed}`));
    $('fim').classList.remove('hidden');
  }

  // ---------- inicialização ----------
  // ---------- modelos neurais disponíveis (manifesto) ----------
  let MANIFEST = { ISR: [], EGY: [] };
  function urlModelo(lado) {
    const sel = $('modelo' + lado);
    const m = MANIFEST[lado].find(x => x.id === (sel && sel.value));
    return m ? m.url : null;
  }

  async function montarManifest() {
    try {
      const resp = await fetch('models/manifest.json');
      if (resp.ok) MANIFEST = await resp.json();
    } catch (e) { /* sem modelos: opção neural ficará vazia */ }
    for (const lado of ['ISR', 'EGY']) {
      const sel = $('modelo' + lado);
      sel.replaceChildren();
      for (const m of MANIFEST[lado] || []) {
        const o = document.createElement('option');
        o.value = m.id; o.textContent = m.nome;
        sel.append(o);
      }
      if (!(MANIFEST[lado] || []).length) {
        const o = document.createElement('option');
        o.textContent = '(nenhum modelo disponível)';
        sel.append(o);
      }
    }
  }

  // habilita o seletor de modelo só quando "IA Neural" está marcado
  function sincronizarSelects() {
    for (const lado of ['ISR', 'EGY']) {
      const neural = (document.querySelector(`input[name="ctrl${lado}"]:checked`) || {}).value === 'neural';
      $('modelo' + lado).disabled = !neural;
    }
  }

  async function iniciarDoMenu() {
    const modos = {};
    for (const lado of ['ISR', 'EGY'])
      modos[lado] = (document.querySelector(`input[name="ctrl${lado}"]:checked`) || {}).value || 'humano';
    // carrega os modelos neurais escolhidos
    const aviso = $('avisoNeural');
    const neurais = ['ISR', 'EGY'].filter(l => modos[l] === 'neural');
    const faltam = neurais.filter(l => !YK.IANeural.carregado(l, urlModelo(l)) && urlModelo(l));
    if (faltam.length) {
      aviso.classList.remove('hidden');
      aviso.textContent = 'Carregando rede(s) treinada(s)…';
      try {
        await Promise.all(faltam.map(l => YK.IANeural.carregar(l, urlModelo(l))));
      } catch (e) {
        aviso.textContent = 'Falha ao carregar a IA neural — usando a heurística. (' + e.message + ')';
        for (const l of neurais) modos[l] = 'ia';
      }
      aviso.classList.add('hidden');
    }
    for (const l of neurais) if (!urlModelo(l)) modos[l] = 'ia';  // sem modelo: heurística
    iniciar(modos);
  }

  function iniciar(modos) {
    const seedIn = parseInt($('seed').value, 10);
    state = YK.novoJogo({ modos, seed: isNaN(seedIn) ? undefined : seedIn });
    YK.onLog = () => { if (state && $('log')) renderLog(); };
    $('setup').classList.add('hidden');
    $('fim').classList.add('hidden');
    $('app').classList.remove('hidden');
    desenharTabuleiro();
    movidas = new Set();
    prepararFase();
  }

  // ---------- guia de peças da tela inicial ----------
  function miniPeca(side, tipo, ic, im, alcance, baixas) {
    const svg = el('svg');
    svg.setAttribute('viewBox', '0 0 44 42');
    svg.setAttribute('width', 44); svg.setAttribute('height', 42);
    const g = el('g');
    g.setAttribute('class',
      'unidade ' + (side === 'EGY' ? 'egy' : 'isr') + (baixas ? ' baixas' : ''));
    const r = el('rect');
    r.setAttribute('x', 6); r.setAttribute('y', 5);
    r.setAttribute('width', 32); r.setAttribute('height', 30);
    r.setAttribute('rx', 3); r.setAttribute('class', 'corpo');
    g.append(r);
    g.append(silhueta(tipo, 22, 15));
    if (tipo !== 'sam') {
      const t = el('text');
      t.setAttribute('x', 22); t.setAttribute('y', 32);
      t.setAttribute('text-anchor', 'middle');
      t.textContent = `${ic}-${im}`;
      g.append(t);
      if (alcance) {
        const a = el('text');
        a.setAttribute('x', 35); a.setAttribute('y', 14);
        a.setAttribute('text-anchor', 'end');
        a.textContent = alcance;
        g.append(a);
      }
    }
    svg.append(g);
    return svg;
  }

  function montarGuiaPecas() {
    const alvo = $('guiaPecas');
    if (!alvo) return;
    const PECAS = [
      ['EGY', 'Egito (rosa)', [
        ['inf', 'Infantaria', 2, 15, 1, 8, 0],
        ['transp', 'Transportes blindados', 2, 20, 1, 10, 0],
        ['tank', 'Tanques', 3, 20, 1, 10, 0],
        ['htank', 'Tanques pesados', 5, 20, 2, 10, 0],
        ['art', 'Artilharia', 3, 15, 1, 8, 8],
        ['rocket', 'Foguetes terra-terra', 3, 15, 1, 8, 4],
        ['sam', 'Base SAM (fixa)', 0, 0, 0, 0, 0],
      ]],
      ['ISR', 'Israel (azul)', [
        ['tank', 'Tanques', 4, 20, 2, 10, 0],
        ['transp', 'Transportes blindados', 2, 20, 1, 10, 0],
        ['eng', 'Engenharia', 2, 15, 1, 8, 0],
        ['artm', 'Artilharia automotiva (longo alcance)', 2, 20, 1, 10, 12],
        ['artm', 'Artilharia automotiva (médio alcance)', 2, 20, 1, 10, 8],
      ]],
    ];
    alvo.replaceChildren();
    for (const [side, titulo, lista] of PECAS) {
      alvo.append(elx('h4', 'guiaLado', titulo));
      for (const [tipo, nome, ic, im, icR, imR, alc] of lista) {
        const linha = elx('div', 'guiaLinha');
        linha.append(miniPeca(side, tipo, ic, im, alc, false));
        if (tipo !== 'sam') linha.append(miniPeca(side, tipo, icR, imR, alc, true));
        const txt = tipo === 'sam'
          ? `${nome} — sem valores: não se move, não tem zona de engajamento e é destruída quando uma unidade israelense ocupa ou atravessa a sua casa.`
          : `${nome} — intacta ${ic}-${im}${alc ? ` (alcance ${alc})` : ''}; ` +
            `com baixas ${icR}-${imR}${alc ? ` (alcance ${alc})` : ''}.`;
        linha.append(elx('span', '', txt));
        alvo.append(linha);
      }
    }
  }
  montarGuiaPecas();

  montarManifest();
  sincronizarSelects();
  document.querySelectorAll('input[name="ctrlISR"], input[name="ctrlEGY"]')
    .forEach(r => r.addEventListener('change', sincronizarSelects));
  $('btnIniciar').addEventListener('click', iniciarDoMenu);
  $('btnFase').addEventListener('click', encerrarFase);
  $('chkPasso').addEventListener('change', e => { passoAPasso = e.target.checked; });
  $('btnPasso').addEventListener('click', avancarPasso);
  $('btnPular').addEventListener('click', pularRestante);
  const reiniciar = () => {
    state = null;
    $('app').classList.add('hidden');
    $('fim').classList.add('hidden');
    $('setup').classList.remove('hidden');
  };
  $('btnNovo').addEventListener('click', reiniciar);
  $('btnNovo2').addEventListener('click', reiniciar);
})(typeof window !== 'undefined' ? window : globalThis);
