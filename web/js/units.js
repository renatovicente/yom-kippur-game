// Definições das unidades — A Guerra do Yom Kippur
(function (G) {
  G.YK = G.YK || {};

  const TIPOS = {
    inf:    { nome: 'Infantaria' },
    tank:   { nome: 'Tanques' },
    htank:  { nome: 'Tanques pesados' },
    transp: { nome: 'Transportes blindados' },
    art:    { nome: 'Artilharia' },
    artm:   { nome: 'Artilharia automotiva' },
    rocket: { nome: 'Foguetes terra-terra' },
    eng:    { nome: 'Engenharia' },
    sam:    { nome: 'Base SAM' },
  };

  // fábrica de contadores: [ic, im] intacto / [icR, imR] com baixas / alcance (artilharia)
  let seq = 0;
  function mk(side, tipo, ic, im, icR, imR, alcance, hex, entrada) {
    return {
      id: 'u' + (++seq),
      side, tipo, ic, im, icR, imR,
      alcance: alcance || 0,
      baixas: 0,          // 0 = intacta, 1 = com baixas (2ª baixa elimina)
      hex: hex || null,   // null = fora do tabuleiro
      entrada: entrada || null, // rodada a partir da qual pode entrar (reforço)
      fired: 0,           // última rodada em que a artilharia atuou
      dead: false,
    };
  }

  function criarUnidades() {
    seq = 0;
    const u = [];
    // ===== Egípcias (5.1/5.2) — posições iniciais no tabuleiro =====
    for (const h of ['0803', '2101', '2103', '1905', '1615', '0722'])
      u.push(mk('EGY', 'inf', 2, 15, 1, 8, 0, h));
    u.push(mk('EGY', 'transp', 2, 20, 1, 10, 0, '1512'));
    u.push(mk('EGY', 'transp', 2, 20, 1, 10, 0, '1311'));
    u.push(mk('EGY', 'rocket', 3, 15, 1, 8, 4, '1802'));
    u.push(mk('EGY', 'rocket', 3, 15, 1, 8, 4, '1604'));
    u.push(mk('EGY', 'art', 3, 15, 1, 8, 8, '1304'));
    u.push(mk('EGY', 'tank', 3, 20, 1, 10, 0, '1502'));
    for (const h of ['0211', '0216', '0121'])
      u.push(mk('EGY', 'sam', 0, 0, 0, 0, 0, h));
    // ===== Israelenses (5.3) — entram pela 2505 (Jerusalém) ou 1922 =====
    for (let i = 0; i < 7; i++) u.push(mk('ISR', 'tank', 4, 20, 2, 10, 0, null, 1));
    for (let i = 0; i < 3; i++) u.push(mk('ISR', 'transp', 2, 20, 1, 10, 0, null, 1));
    u.push(mk('ISR', 'eng', 2, 15, 1, 8, 0, null, 1));
    u.push(mk('ISR', 'artm', 2, 20, 1, 10, 12, null, 1)); // longo alcance
    u.push(mk('ISR', 'artm', 2, 20, 1, 10, 8, null, 1));  // médio alcance
    // ===== Reforços israelenses (6.3) — após a ponte de engenharia, via 2505 =====
    for (let i = 0; i < 3; i++) u.push(mk('ISR', 'tank', 4, 20, 2, 10, 0, null, 99)); // 99 = aguarda ponte
    for (let i = 0; i < 3; i++) u.push(mk('ISR', 'transp', 2, 20, 1, 10, 0, null, 99));
    // ===== Reforços egípcios (6.5) — via 1201 / 0621 / 0722 =====
    u.push(mk('EGY', 'transp', 2, 20, 1, 10, 0, null, 3));
    u.push(mk('EGY', 'rocket', 3, 15, 1, 8, 4, null, 3));
    u.push(mk('EGY', 'transp', 2, 20, 1, 10, 0, null, 4));
    u.push(mk('EGY', 'htank', 5, 20, 2, 10, 0, null, 4));
    u.push(mk('EGY', 'art', 3, 15, 1, 8, 8, null, 4));
    u.push(mk('EGY', 'art', 3, 15, 1, 8, 8, null, 4));
    u.push(mk('EGY', 'transp', 2, 20, 1, 10, 0, null, 5));
    u.push(mk('EGY', 'htank', 5, 20, 2, 10, 0, null, 5));
    u.push(mk('EGY', 'htank', 5, 20, 2, 10, 0, null, 5));
    return u;
  }

  function icAtual(u) { return u.baixas ? u.icR : u.ic; }
  function imAtual(u) { return u.baixas ? u.imR : u.im; }
  function nomeUnidade(u) {
    const t = TIPOS[u.tipo].nome;
    const v = u.tipo === 'sam' ? '' :
      ` ${icAtual(u)}-${imAtual(u)}` + (u.alcance ? ` (alcance ${u.alcance})` : '');
    return `${t}${v} ${u.side === 'EGY' ? 'egípcia' : 'israelense'}`;
  }

  G.YK.TIPOS = TIPOS;
  G.YK.criarUnidades = criarUnidades;
  G.YK.icAtual = icAtual;
  G.YK.imAtual = imAtual;
  G.YK.nomeUnidade = nomeUnidade;
})(typeof window !== 'undefined' ? window : globalThis);
