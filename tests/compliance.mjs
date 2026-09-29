// Teste de conformidade da implementação às regras (REGRAS.md / livreto original)
// Execute com: node tests/compliance.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['map-data.js', 'units.js', 'rules.js', 'game.js', 'ai.js'])
  (0, eval)(readFileSync(join(root, 'web/js', f), 'utf8'));
const YK = globalThis.YK;

let secao = '';
const resultados = {};
function sec(nome) { secao = nome; resultados[secao] = { ok: 0, falha: 0 }; console.log(`\n== ${nome}`); }
function ok(cond, msg) {
  if (cond) resultados[secao].ok++;
  else { resultados[secao].falha++; console.error(`   FALHA: ${msg}`); }
}
// dados forçados: cada valor 0..1 vira um dado 1..6 (dois valores por rolagem)
function dadosFixos(...vals) { let i = 0; return () => vals[i++ % vals.length]; }
const D = { 2: [0, 0], 7: [0.99, 0], 12: [0.99, 0.99] };
function novo() { return YK.novoJogo({ modos: { ISR: 'ia', EGY: 'ia' }, seed: 1 }); }
// decisor instrumentado
function decisorTeste(state, cb, registros) {
  const auto = YK.decisorAuto(state, cb, 'ISR');
  return {
    escolherBaixa: (p, c) => { registros.baixa = c.slice(); return auto.escolherBaixa(p, c); },
    escolherEliminada: (p, c) => { registros.elim = c.slice(); return auto.escolherEliminada(p, c); },
    escolherRecuo: () => null,
    avancar: (combate, vagas) => { registros.vagas = vagas.slice(); return auto.avancar(combate, vagas); },
  };
}
function limparZona(state, hexes) {
  for (const u of state.units) if (u.hex && hexes.includes(u.hex)) u.hex = null;
}

// ============================================================
sec('§3/§5 — Peças: composição, valores e posição inicial (5.1-5.4)');
{
  const st = novo();
  const egy = st.units.filter(u => u.side === 'EGY');
  const isr = st.units.filter(u => u.side === 'ISR');
  ok(egy.length === 24, '24 peças egípcias');
  // o material físico traz 21 peças azuis, mas as regras 5.3+6.3 enumeram
  // 19 unidades jogáveis (13 iniciais + 6 reforços); as 2 restantes são reservas
  ok(isr.length === 19, '19 unidades israelenses jogáveis (5.3 + 6.3)');
  const noMapa = egy.filter(u => u.hex);
  ok(noMapa.length === 15, '15 unidades egípcias no tabuleiro no início');
  for (const [h, tipo] of [['0803','inf'],['2101','inf'],['2103','inf'],['1905','inf'],
       ['1615','inf'],['0722','inf'],['1512','transp'],['1311','transp'],
       ['1802','rocket'],['1604','rocket'],['1304','art'],['1502','tank'],
       ['0211','sam'],['0216','sam'],['0121','sam']]) {
    const u = YK.unidadeEm(st, h);
    ok(u && u.tipo === tipo, `posição inicial ${tipo} em ${h}`);
  }
  // valores intacta/baixas (tabela do §3)
  const v = (side, tipo) => st.units.find(u => u.side === side && u.tipo === tipo);
  const chk = (u, ic, im, icR, imR, al) =>
    u.ic === ic && u.im === im && u.icR === icR && u.imR === imR && (al === undefined || u.alcance === al);
  ok(chk(v('EGY','inf'), 2,15,1,8), 'infantaria 2-15 → 1-8');
  ok(chk(v('EGY','transp'), 2,20,1,10), 'transporte 2-20 → 1-10');
  ok(chk(v('EGY','tank'), 3,20,1,10), 'tanque egípcio 3-20 → 1-10');
  ok(chk(v('EGY','htank'), 5,20,2,10), 'tanque pesado 5-20 → 2-10');
  ok(chk(v('ISR','tank'), 4,20,2,10), 'tanque israelense 4-20 → 2-10');
  ok(chk(v('EGY','art'), 3,15,1,8,8), 'artilharia 3-15 alcance 8');
  ok(chk(v('EGY','rocket'), 3,15,1,8,4), 'foguetes 3-15 alcance 4');
  ok(chk(v('ISR','eng'), 2,15,1,8), 'engenharia 2-15 → 1-8');
  const arts = st.units.filter(u => u.side === 'ISR' && u.tipo === 'artm').map(u => u.alcance).sort((a,b)=>a-b);
  ok(arts.join(',') === '8,12', 'artilharias automotivas com alcances 8 e 12');
  ok(isr.filter(u => u.tipo === 'tank').length === 10, '7 tanques iniciais + 3 de reforço');
  ok(isr.filter(u => u.tipo === 'transp').length === 6, '3 transportes iniciais + 3 de reforço');
}

// ============================================================
sec('§6 — Sequência de jogo (1.1-1.3)');
{
  ok(YK.FASES.length === 8, 'rodada tem 8 fases');
  ok(YK.FASES.map(f => f.kind).join(',') ===
     'mov,ataque,cobertura,resolve,mov,ataque,cobertura,resolve', 'ordem das fases');
  ok(YK.FASES[0].side === 'ISR' && YK.FASES[4].side === 'EGY', 'Israel joga primeiro (1.2)');
  ok(YK.FASES[2].side === 'EGY' && YK.FASES[6].side === 'ISR', 'cobertura é do defensor');
  const st = novo();
  st.round = 6; st.fase = 7;
  YK.proximaFase(st);
  ok(st.fim !== null, 'partida termina ao fim da 6ª rodada (8)');
}

// ============================================================
sec('§7 — Movimentação (2.2.x)');
{
  const st = novo();
  // custos por terreno (Tabela de Influência do Terreno na Movimentação)
  ok(YK.custoEntrada(st, 'EGY', '1602', '1601') === 3, 'dunas: 3 pontos');
  ok(YK.custoEntrada(st, 'EGY', '1402', '1503') === 1, 'estrada: 1 ponto');
  ok(YK.custoEntrada(st, 'ISR', '2406', '2306') === 4 || YK.MAP.terrain['2306'] !== 'acidentado',
     'acidentado: 4 pontos');
  ok(YK.custoEntrada(st, 'EGY', '1002', '1102') === 1, 'cidade: 1 ponto');
  // água doce: feature de aresta — "3 pontos por travessia", grátis pelas pontes
  const CUSTOS = { aberto: 2, dunas: 3, bosque: 3, acidentado: 4, cidade: 1 };
  ok(YK.arestaAguaDoce('0202', '0203'), 'o canal corre entre 0202 e 0203');
  ok(YK.custoEntrada(st, 'EGY', '0202', '0203') === CUSTOS[YK.MAP.terrain['0203']] + 3,
     'travessia do canal: +3');
  ok(YK.custoEntrada(st, 'EGY', '0503', '0504') === 1,
     'travessia por ponte de estrada (0503-0504): sem sobretaxa');
  ok(!YK.arestaAguaDoce('0905', '0906') &&
     YK.custoEntrada(st, 'EGY', '1009', '1010') === CUSTOS[YK.MAP.terrain['1010']],
     'mover ao longo da margem não paga travessia');
  // limite do IM
  const tank = st.units.find(u => u.side === 'ISR' && u.tipo === 'tank');
  tank.hex = '2509';
  const alc = YK.alcance(st, tank);
  ok([...alc.values()].every(i => i.custo <= 20), 'nenhum destino acima do IM (2.2.6)');
  // não entra em lago, não para sobre unidade, atravessa amiga
  ok(![...alc.keys()].some(h => YK.ehAgua(h) && !YK.ROADHEX.has(h)), 'lagos proibidos (2.2.24)');
  const t2 = st.units.filter(u => u.side === 'ISR' && u.tipo === 'tank')[1];
  t2.hex = '2508';
  const alc2 = YK.alcance(st, t2);
  ok(!alc2.has('2509'), 'não pode parar sobre unidade amiga (2.2.13)');
  ok([...alc2.values()].some(i => i.caminho.includes('2509')), 'pode atravessar unidade amiga (2.2.13)');
  // SAM não se move
  const sam = st.units.find(u => u.tipo === 'sam');
  ok(YK.alcance(st, sam).size === 0, 'SAM não se movimenta (2.2.21)');
}

// ============================================================
sec('§8 — Zonas de engajamento (3.x)');
{
  const st = novo();
  const tank = st.units.find(u => u.side === 'ISR' && u.tipo === 'tank');
  // parada obrigatória ao entrar em ZOC (2.2.18)
  tank.hex = '2106'; // a caminho da infantaria de 2103
  const alc = YK.alcance(st, tank);
  const zoc = YK.zocInimiga(st, 'ISR');
  let atravessou = false;
  for (const [h, info] of alc) {
    const idx = info.caminho.slice(1).findIndex(x => zoc.has(x));
    if (idx >= 0 && idx < info.caminho.length - 2) atravessou = true;
  }
  ok(!atravessou, 'movimento para ao entrar em ZOC inimiga (2.2.18)');
  // engajada não se move (3.2)
  tank.hex = '2102';
  ok(YK.engajada(st, tank), 'adjacência engaja');
  ok(YK.alcance(st, tank).size === 0, 'unidade engajada não se move (3.2)');
  // SAM não tem ZOC (3.1)
  const t2 = st.units.filter(u => u.side === 'ISR' && u.tipo === 'tank')[1];
  t2.hex = '0212'; // vizinho da SAM 0211
  ok(!YK.engajada(st, t2), 'SAM não engaja (3.1)');
  ok(YK.alcance(st, t2).size > 0, 'unidade ao lado de SAM move-se livremente');
  // ZOC atravessa o canal (3.3): 1202 (oeste) x 1203 (leste)
  const st3 = novo();
  limparZona(st3, ['1202', '1203']);
  const a = st3.units.find(u => u.side === 'ISR' && u.tipo === 'tank');
  const b = st3.units.find(u => u.side === 'EGY' && u.tipo === 'inf');
  a.hex = '1203'; b.hex = '1202';
  ok(YK.engajada(st3, a) && YK.engajada(st3, b), 'engajamento através do canal (3.3)');
  ok(YK.combates(st3, 'ISR').length === 1, 'combate obrigatório através do canal');
}

// ============================================================
sec('§4.2/§9 — Canal de Suez e pontes (2.2.14-2.2.17, 4.3)');
{
  const st = novo();
  ok(YK.podeCruzarCanal(st, '1202', '1303', 'EGY'), 'Egito cruza pela ponte de Ismaília');
  ok(YK.podeCruzarCanal(st, '1202', '1303', 'ISR'), 'Israel também pode usar Ismaília');
  ok(!YK.podeCruzarCanal(st, '1213', '1313', 'EGY'), 'sem ponte não há travessia');
  const eng = st.units.find(u => u.tipo === 'eng');
  eng.hex = '1310';
  ok(YK.pontesEng(st) === '1310', 'ponte instalada em casa elegível (2.2.15)');
  ok(YK.podeCruzarCanal(st, '1210', '1310', 'ISR'), 'israelenses cruzam pela ponte de engenharia');
  ok(!YK.podeCruzarCanal(st, '1210', '1310', 'EGY'), 'egípcios não usam a ponte de engenharia');
  ok(YK.custoEntrada(st, 'ISR', '1410', '1310') === 1, 'passagem pela ponte custa 1 (2.2.16)');
  // elegibilidade: margem leste, vizinho de terra a oeste, longe dos lagos
  ok(!YK.elegivelPonte('1306'), 'casa vizinha ao lago não é elegível');
  ok(!YK.elegivelPonte('1213'), 'margem oeste não é elegível');
  ok(YK.elegivelPonte('1309') && YK.elegivelPonte('1315'), 'trecho entre os lagos é elegível');
  ok(!YK.elegivelPonte('1316'), '1316 não elegível (adjacente ao Grande Lago Amargo)');
  // engenharia não cruza o canal (2.2.17) — afasta o transporte de 1311 para
  // garantir que a engenharia esteja livre (senão o teste passaria trivialmente)
  const transp1311 = YK.unidadeEm(st, '1311');
  if (transp1311) transp1311.hex = '1611';
  ok(!YK.engajada(st, eng), 'cenário válido: engenharia desengajada');
  const alcEng = YK.alcance(st, eng);
  ok(alcEng.size > 0, 'engenharia pode se mover');
  ok(![...alcEng.keys()].some(h => YK.oeste(h)), 'engenharia não cruza o canal (2.2.17)');
  if (transp1311) transp1311.hex = '1311';
  // a ponte some se a engenharia sai
  eng.hex = '1410';
  ok(YK.pontesEng(st) === null, 'ponte desfeita quando a engenharia sai');
  // engenharia eliminada retorna como reforço pela 2505 (4.3.2)
  const st2 = novo();
  const eng2 = st2.units.find(u => u.tipo === 'eng');
  eng2.hex = '1310'; st2.round = 2;
  YK.eliminar(st2, eng2, 'teste');
  ok(!eng2.dead && eng2.hex === null && eng2.entrada === 3, 'engenharia volta ao pool (4.3.2)');
  st2.round = 3;
  ok(YK.casasEntrada(st2, eng2).join(',') === '2505', 'retorno apenas pela 2505');
}

// ============================================================
sec('§10.1 — Combates obrigatórios e combinados (4.1.x)');
{
  const st = novo();
  limparZona(st, ['2102']);
  const t1 = st.units.find(u => u.side === 'ISR' && u.tipo === 'tank');
  t1.hex = '2102'; // adjacente a 2101 e 2103
  const cbs = YK.combates(st, 'ISR');
  ok(cbs.length === 1, 'um único combate combinado');
  ok(cbs[0].defensores.length === 2, 'atacante adjacente a duas inimigas ataca ambas (4.1.5)');
  // dois atacantes sobre o mesmo defensor somam IC (4.1.4)
  const t2 = st.units.filter(u => u.side === 'ISR' && u.tipo === 'tank')[1];
  t2.hex = '2201';
  const cbs2 = YK.combates(st, 'ISR');
  ok(cbs2.length === 1 && cbs2[0].atacantes.length === 2, 'atacantes adjacentes combinam');
  // nenhuma unidade em dois combates (4.1.6)
  const ids = new Set();
  let dup = false;
  for (const cb of cbs2) for (const u of [...cb.atacantes, ...cb.defensores]) {
    if (ids.has(u.id)) dup = true; ids.add(u.id);
  }
  ok(!dup, 'nenhuma unidade em dois combates (4.1.6)');
}

// ============================================================
sec('§10.2 — Artilharia (4.2.x)');
{
  const st = novo();
  limparZona(st, ['2102']);
  const t1 = st.units.find(u => u.side === 'ISR' && u.tipo === 'tank');
  t1.hex = '2102';
  const cb = YK.combates(st, 'ISR')[0];
  // alcance: foguete egípcio (alcance 4) em 1802 não alcança 2101? dist(1802,2101)=?
  const rocket = YK.unidadeEm(st, '1802');
  const d = Math.min(...cb.defensores.map(x => YK.dist(rocket.hex, x.hex)));
  const disp = YK.artilhariasDisponiveis(st, 'EGY', cb);
  ok(disp.includes(rocket) === (d <= 4), `alcance respeitado (dist ${d} x alcance 4)`);
  // artilharia já usada na rodada não atua de novo (4.2.7)
  rocket.fired = st.round;
  ok(!YK.artilhariasDisponiveis(st, 'EGY', cb).includes(rocket), 'uma atuação por rodada (4.2.7)');
  rocket.fired = 0;
  // artilharia engajada não dá barragem/cobertura (4.2.4)
  const t3 = st.units.filter(u => u.side === 'ISR' && u.tipo === 'tank')[2];
  t3.hex = YK.vizinhos(rocket.hex).find(h => !YK.unidadeEm(st, h) && !YK.ehAgua(h));
  ok(!YK.artilhariasDisponiveis(st, 'EGY', cb).includes(rocket), 'artilharia engajada não apoia (4.2.4)');
  t3.hex = null;
  // cobertura soma IC sem terreno (4.5.10) e barragem idem
  const { def: defAntes } = YK.totaisCombate(st, cb);
  cb.cobertura.push(rocket);
  const { def: defDepois } = YK.totaisCombate(st, cb);
  ok(defDepois - defAntes === YK.icAtual(rocket), 'cobertura soma apenas o IC (4.5.10)');
  cb.cobertura.length = 0;
}

// ============================================================
sec('§10.3 — Relação de forças: limiares exatos (4.5.3)');
{
  ok(YK.colunaRelacao(2, 4) === -2, 'A = metade de D → −2');
  ok(YK.colunaRelacao(3, 7) === -2, 'A < metade → −2');
  ok(YK.colunaRelacao(3, 4) === -1, 'metade < A < D → −1');
  ok(YK.colunaRelacao(4, 4) === 0, 'A = D → =');
  ok(YK.colunaRelacao(7, 4) === 0, 'A < 2D → =');
  ok(YK.colunaRelacao(8, 4) === 1, 'A = 2D → +1');
  ok(YK.colunaRelacao(11, 4) === 1, 'A < 3D → +1');
  ok(YK.colunaRelacao(12, 4) === 2, 'A = 3D → +2');
  ok(YK.colunaRelacao(22, 1) === 2, 'extremo da TRF (22x1) → +2');
  ok(YK.colunaRelacao(1, 22) === -2, 'extremo da TRF (1x22) → −2');
}

// ============================================================
sec('§10.4/10.5 — Efeitos de combate com dados forçados (4.5.5-4.5.7)');
{
  // DE-AVI: defensor eliminado, atacante pode avançar
  let st = novo();
  limparZona(st, ['2102', '2103']); // isola a defensora de 2101
  let atks = st.units.filter(u => u.side === 'ISR' && u.tipo === 'tank').slice(0, 3);
  atks[0].hex = '2102'; atks[1].hex = '2001'; atks[2].hex = '2201';
  const def1 = YK.unidadeEm(st, '2101');
  let cb = YK.combates(st, 'ISR')[0];
  let reg = {};
  let res = await YK.resolverCombate(st, cb, dadosFixos(...D[2]), decisorTeste(st, cb, reg));
  ok(res.dados === 2 && res.resultado === 'DE-AVI', `coluna +2, dados 2 → DE-AVI (obtido ${res.resultado})`);
  ok(def1.dead, 'DE: defensora eliminada');
  ok(reg.vagas && reg.vagas.includes('2101'), 'AVI: avanço ofertado para a casa vaga');
  ok(atks.every(a => !a.dead && !a.baixas), 'AVI: atacantes intactos');

  // DVB-ARB na coluna −2 (dados 6): baixas dos dois lados + recuo do atacante
  st = novo();
  limparZona(st, ['2102', '2103']);
  const inf = YK.unidadeEm(st, '2101');
  const t1 = st.units.find(u => u.side === 'ISR' && u.tipo === 'transp'); // IC 2 x defesa 2+0(aberto? dunas+2)=...
  t1.hex = '2102';
  cb = YK.combates(st, 'ISR')[0];
  const tot = YK.totaisCombate(st, cb);
  ok(YK.colunaRelacao(tot.atq, tot.def) === -2, `cenário em coluna −2 (${tot.atq}x${tot.def})`);
  reg = {};
  res = await YK.resolverCombate(st, cb, dadosFixos(0.85, 0), decisorTeste(st, cb, reg)); // 6+1=7 → DVI-ARB
  ok(res.resultado === 'DVI-ARB', `dados 7 na −2 → DVI-ARB (obtido ${res.resultado})`);
  ok(!inf.baixas && !inf.dead && inf.hex === '2101', 'DVI: defensora intacta e na posição');
  ok(t1.baixas === 1, 'ARB: atacante sofre baixas');
  ok(t1.hex !== '2102', 'ARB: atacante recuou');
  const zocEgy = YK.zocInimiga(st, 'ISR');
  ok(!zocEgy.has(t1.hex), 'recuo sai da zona de engajamento (4.5.8)');

  // reincidência: segunda baixa elimina (4.5.9)
  ok((() => { const s = novo(); const u = YK.unidadeEm(s, '2101');
    YK.sofrerBaixas(s, u); YK.sofrerBaixas(s, u); return u.dead; })(),
    'reincidência elimina (4.5.9)');

  // escolha de baixas recai primeiro sobre unidades já com baixas (4.5.9)
  const sx = novo();
  const u1 = YK.unidadeEm(sx, '2101'), u2 = YK.unidadeEm(sx, '2103');
  u2.baixas = 1;
  ok(YK.candidatosBaixa([u1, u2]).every(u => u === u2), 'baixa obrigatória na unidade já ferida');

  // baixas viram o verso: IC/IM reduzidos
  const sv = novo();
  const uv = YK.unidadeEm(sv, '1502'); // tanque 3-20
  YK.sofrerBaixas(sv, uv);
  ok(YK.icAtual(uv) === 1 && YK.imAtual(uv) === 10, 'verso da peça: 3-20 vira 1-10');
}

// ============================================================
sec('§10.7 — Recuos (4.5.8): impossível, cadeia e ponte');
{
  // recuo impossível = eliminação
  let st = novo();
  const u = st.units.find(x => x.side === 'EGY' && x.tipo === 'tank');
  u.hex = '0101';
  const viz = YK.vizinhos('0101').filter(h => !YK.ehAgua(h));
  const isr = st.units.filter(x => x.side === 'ISR').slice(0, viz.length);
  viz.forEach((h, i) => { isr[i].hex = h; });
  YK.recuar(st, u, null);
  ok(u.dead, 'recuo impossível elimina (4.5.8)');

  // recuo para ZOC inimiga é proibido: cercado por ZOC = eliminação
  st = novo();
  limparZona(st, ['0101', '0102', '0201', '0202']);
  const z = st.units.find(x => x.side === 'EGY' && x.tipo === 'tank');
  z.hex = '0101';
  st.units.find(x => x.side === 'ISR' && x.tipo === 'tank').hex = '0201';
  // vizinhos de 0101: 0102 (em ZOC de 0201) e 0201 (inimiga) → recuo impossível
  YK.recuar(st, z, null);
  ok(z.dead, 'não recua para ZOC inimiga: cercado é eliminado (4.5.8)');

  // deslocamento em cadeia: única casa de recuo fora de ZOC está ocupada por amiga
  st = novo();
  limparZona(st, ['0105', '0106', '0107', '0204', '0104', '0205']);
  const a = st.units.find(x => x.side === 'EGY' && x.tipo === 'tank');
  const amiga = st.units.find(x => x.side === 'EGY' && x.tipo === 'transp');
  a.hex = '0105'; amiga.hex = '0106';
  st.units.find(x => x.side === 'ISR' && x.tipo === 'tank').hex = '0204';
  // candidatos de recuo de 0105: 0104/0205 em ZOC, 0204 inimiga → resta 0106 (amiga)
  YK.recuar(st, a, '0106');
  ok(!a.dead && a.hex === '0106', 'recuou para casa de amiga deslocada');
  ok(amiga.hex !== '0106' && !amiga.dead, 'amiga deslocada em cadeia');

  // recuo israelense de 2 casas pela ponte de engenharia
  st = novo();
  limparZona(st, ['1310', '1410', '1210', '1211', '1209']);
  const eng = st.units.find(x => x.tipo === 'eng');
  eng.hex = '1310';
  const t = st.units.find(x => x.side === 'ISR' && x.tipo === 'tank');
  t.hex = '1410';
  // cerca o tanque por todos os lados exceto a ponte
  const cerco = YK.vizinhos('1410').filter(h => h !== '1310' && !YK.ehAgua(h));
  const egy = st.units.filter(x => x.side === 'EGY' && x.tipo !== 'sam' && !x.hex || x.side === 'EGY' && x.tipo !== 'sam').slice(0, cerco.length);
  cerco.forEach((h, i) => { const w = YK.unidadeEm(st, h); if (!w) egy[i].hex = h; });
  YK.recuar(st, t, null);
  ok(!t.dead && YK.oeste(t.hex), `recuo de 2 casas pela ponte para a outra margem (foi para ${t.hex})`);
}

// ============================================================
sec('§10.8 — Bases SAM (2.2.21, 5.2, regra de captura 7.2)');
{
  const st = novo();
  const sam = st.units.find(u => u.tipo === 'sam' && u.hex === '0211');
  const t = st.units.find(u => u.side === 'ISR' && u.tipo === 'tank');
  t.hex = '0311';
  const alc = YK.alcance(st, t);
  ok(alc.has('0211'), 'israelense pode ocupar a casa da SAM');
  // atravessar também destrói
  const caminho = [...alc.values()].find(i => i.caminho.includes('0211') && i.caminho[i.caminho.length - 1] !== '0211');
  if (caminho) {
    YK.mover(st, t, caminho.caminho[caminho.caminho.length - 1], caminho.caminho);
    ok(sam.dead, 'SAM eliminada ao ser atravessada');
  } else {
    YK.mover(st, t, '0211', alc.get('0211').caminho);
    ok(sam.dead, 'SAM eliminada ao ser ocupada');
  }
  ok(YK.combates(st, 'ISR').every(cb => !cb.defensores.some(d => d.tipo === 'sam')),
    'SAM nunca é defensora em combate');
}

// ============================================================
sec('§11 — Reforços (6.x)');
{
  const st = novo();
  ok(YK.poolEntrada(st, 'EGY').length === 0, 'Egito sem reforços na rodada 1');
  st.round = 3;
  const r3 = YK.poolEntrada(st, 'EGY');
  ok(r3.length === 2 && r3.some(u => u.tipo === 'transp') && r3.some(u => u.tipo === 'rocket'),
    '3ª rodada: transporte + foguetes (6.5)');
  st.round = 4;
  const r4 = YK.poolEntrada(st, 'EGY');
  ok(r4.filter(u => u.tipo === 'art').length === 2 && r4.some(u => u.tipo === 'htank'),
    '4ª rodada: +transporte, tanque pesado e 2 artilharias');
  st.round = 5;
  ok(YK.poolEntrada(st, 'EGY').filter(u => u.tipo === 'htank').length === 3,
    '5ª rodada: +2 tanques pesados; reforços acumulam (6.7)');
  // entradas egípcias corretas (0722 começa ocupada pela infantaria inicial — 6.8)
  const r = YK.poolEntrada(st, 'EGY')[0];
  ok(YK.casasEntrada(st, r).sort().join(',') === '0621,1201',
    'entrada ocupada (0722) é bloqueada (6.8)');
  YK.unidadeEm(st, '0722').hex = '0820';
  ok(YK.casasEntrada(st, r).sort().join(',') === '0621,0722,1201', 'entradas egípcias 1201/0621/0722 (6.6)');
  // reforços israelenses: só após a ponte e com ela de pé (6.1-6.2)
  const si = novo();
  si.round = 3;
  ok(si.units.filter(u => u.side === 'ISR' && u.entrada === 99 && YK.poolEntrada(si, 'ISR').includes(u)).length === 0,
    'sem ponte, sem reforços israelenses');
  const eng = si.units.find(u => u.tipo === 'eng');
  eng.hex = '1310'; si.ponteRodada = 2;
  const ref = YK.poolEntrada(si, 'ISR').filter(u => u.entrada === 99);
  ok(ref.length === 6, 'com ponte: 3 tanques + 3 transportes liberados (6.3)');
  ok(ref.every(u => YK.casasEntrada(si, u).join(',') === '2505'), 'reforços só pela 2505 (6.4)');
  eng.hex = null; // ponte desfeita
  ok(YK.poolEntrada(si, 'ISR').filter(u => u.entrada === 99).length === 0,
    'ponte destruída bloqueia reforços não entrados (6.2)');
  // pedágio em fila (2.2.12)
  const sq = novo();
  const pool = YK.poolEntrada(sq, 'ISR');
  const e1 = YK.entrarUnidade(sq, pool[0], '1922');
  ok(e1.ok && e1.im === YK.imAtual(pool[0]) - 1, '1ª entrada paga 1');
  YK.mover(sq, pool[0], '1820', ['1820']);
  const e2 = YK.entrarUnidade(sq, pool[1], '1922');
  ok(e2.ok && e2.im === YK.imAtual(pool[1]) - 2, '2ª entrada paga 2');
  const e3 = YK.entrarUnidade(sq, pool[2], '2505');
  ok(e3.ok && e3.im === YK.imAtual(pool[2]) - 1, 'contagem independente por casa (2.2.12)');
}

// ============================================================
sec('§12 — Condições de vitória (7.x)');
{
  // marginal egípcia: Israel sem objetivos e estrada bloqueada? não: estrada livre → parcial
  let st = novo();
  let fim = YK.avaliarVitoria(st);
  ok(fim.vencedor === 'EGY' && fim.tipo === 'parcial', 'sem objetivos + estrada livre → parcial egípcia (7.6)');
  // marginal egípcia: estrada bloqueada por israelenses (longe dos objetivos)
  st = novo();
  const bloq = st.units.filter(u => u.side === 'ISR').slice(0, 2);
  bloq[0].hex = '0818'; bloq[1].hex = '0613'; // cortam os dois corredores Fahid→Ismaília
  fim = YK.avaliarVitoria(st);
  ok(!YK.estradaLivre(st), 'estradas Fahid-Ismaília bloqueadas');
  ok(fim.vencedor === 'EGY' && fim.tipo === 'marginal', 'sem objetivos + estrada bloqueada → marginal egípcia (7.7)');
  // decisiva israelense: 3 objetivos
  st = novo();
  for (const s of st.units.filter(u => u.tipo === 'sam')) { s.dead = true; s.hex = null; }
  let rv = 5;
  for (const u of st.units.filter(u => u.side === 'EGY' && u.hex)) u.hex = YK.hid(24, rv++);
  const tk = st.units.filter(u => u.side === 'ISR' && u.tipo === 'tank');
  tk[0].hex = '0803'; tk[1].hex = '1202'; tk[2].hex = '0722';
  fim = YK.avaliarVitoria(st);
  ok(fim.vencedor === 'ISR' && fim.tipo === 'decisiva', '3 objetivos → decisiva israelense (7.1)');
  // parcial israelense: 2 objetivos
  tk[2].hex = '2510';
  fim = YK.avaliarVitoria(st);
  ok(fim.vencedor === 'ISR' && fim.tipo === 'parcial', '2 objetivos → parcial israelense (7.3)');
  // marginal israelense: 1 objetivo
  tk[0].hex = '2511'; tk[1].hex = '2512';
  fim = YK.avaliarVitoria(st);
  ok(fim.vencedor === 'ISR' && fim.tipo === 'marginal', '1 objetivo (SAMs) → marginal israelense (7.4)');
  // decisiva egípcia: perdas israelenses > unidades na margem oeste
  st = novo();
  for (const u of st.units.filter(u => u.side === 'ISR').slice(0, 8)) { u.dead = true; }
  const sob = st.units.find(u => u.side === 'ISR' && !u.dead);
  sob.hex = '1112'; // 1 a oeste, 8 perdidas
  fim = YK.avaliarVitoria(st);
  ok(fim.vencedor === 'EGY' && fim.tipo === 'decisiva', 'perdas > margem oeste → decisiva egípcia (7.5)');
  // captura de SAM por proximidade (7.2): israelense mais próxima do que qualquer egípcia
  st = novo();
  for (const s of st.units.filter(u => u.tipo === 'sam' && u.hex !== '0211')) { s.dead = true; s.hex = null; }
  const sam = st.units.find(u => u.tipo === 'sam' && u.hex === '0211');
  ok(!YK.objetivosIsraelenses(st).samsOK, 'SAM intacta sem israelense perto: não capturada');
  const t = st.units.find(u => u.side === 'ISR' && u.tipo === 'tank');
  t.hex = '0212'; // distância 1 — toda egípcia está mais longe
  const dEgy = Math.min(...st.units.filter(u => u.side === 'EGY' && u.hex && u.tipo !== 'sam')
    .map(u => YK.dist(u.hex, sam.hex)));
  ok(dEgy > 1, 'cenário válido: egípcias a mais de 1 casa');
  ok(YK.objetivosIsraelenses(st).samsOK, 'SAM capturada por proximidade (7.2)');
}

// ============================================================
const totalOk = Object.values(resultados).reduce((s, r) => s + r.ok, 0);
const totalF = Object.values(resultados).reduce((s, r) => s + r.falha, 0);
console.log('\n===== RELATÓRIO DE CONFORMIDADE =====');
for (const [s, r] of Object.entries(resultados))
  console.log(`${r.falha ? '✗' : '✓'} ${s}: ${r.ok} ok${r.falha ? `, ${r.falha} FALHAS` : ''}`);
console.log(`\nTOTAL: ${totalOk} conformes, ${totalF} não conformes`);
process.exit(totalF ? 1 : 0);
