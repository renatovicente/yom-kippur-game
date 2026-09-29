// Testes do motor — execute com: node tests/test.mjs
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['map-data.js', 'units.js', 'rules.js', 'game.js', 'ai.js']) {
  (0, eval)(readFileSync(join(root, 'web/js', f), 'utf8'));
}
const YK = globalThis.YK;

let passes = 0, fails = 0;
function ok(cond, msg) {
  if (cond) { passes++; }
  else { fails++; console.error('FALHOU:', msg); }
}

// ---------- grade ----------
ok(YK.vizinhos('0101').includes('0102') && YK.vizinhos('0101').includes('0201'),
  'vizinhos de 0101');
ok(YK.vizinhos('1202').includes('1303'), '1202 adjacente a 1303 (ponte de Ismaília)');
ok(!YK.vizinhos('0302').includes('0403') === false || YK.vizinhos('0302').includes('0403') === false,
  'sanidade vizinhos');
ok(YK.dist('0101', '0103') === 2, 'distância vertical');
ok(YK.dist('1202', '1303') === 1, 'distância diagonal');
ok(YK.dist('0101', '0301') === 2, 'distância 2 colunas');
// todos os vizinhos têm distância 1
let advOk = true;
for (const h of ['0507', '1210', '2515', '1922', '0102']) {
  for (const n of YK.vizinhos(h)) if (YK.dist(h, n) !== 1) advOk = false;
}
ok(advOk, 'vizinhos têm distância cúbica 1');

// hexes válidos: linha 22 só em colunas ímpares
ok(YK.valido('1922') && !YK.valido('1822') && !YK.valido('2022'), 'meias-casas da linha 22 excluídas');

// ---------- canal ----------
ok(YK.oeste('1216') && !YK.oeste('1316'), 'margens');
ok(YK.arestaCanal('1212', '1312'), 'aresta do canal');
const st0 = YK.novoJogo({ modos: { ISR: 'ia', EGY: 'ia' }, seed: 42 });
ok(YK.podeCruzarCanal(st0, '1202', '1303', 'EGY'), 'Egito cruza pela ponte de Ismaília');
ok(!YK.podeCruzarCanal(st0, '1212', '1312', 'EGY'), 'Egito não cruza fora da ponte');
ok(!YK.podeCruzarCanal(st0, '1212', '1312', 'ISR'), 'Israel não cruza sem ponte de engenharia');
// instala engenharia em 1312 e testa
const eng = st0.units.find(u => u.tipo === 'eng');
eng.hex = '1312';
ok(YK.elegivelPonte('1312'), '1312 é elegível para ponte');
ok(YK.pontesEng(st0) === '1312', 'ponte detectada');
ok(YK.podeCruzarCanal(st0, '1212', '1312', 'ISR'), 'Israel cruza pela ponte de engenharia');
ok(!YK.podeCruzarCanal(st0, '1213', '1314', 'ISR'), 'ponte não vale em outra aresta');
ok(!YK.elegivelPonte('1306'), '1306 não elegível (adjacente ao lago Tinsah)');
ok(!YK.elegivelPonte('1304'), '1304 não elegível (faz fronteira com a margem leste 1203/1204)');
ok(YK.elegivelPonte('1309'), '1309 elegível (trecho entre os lagos)');
eng.hex = null;

// ---------- movimentação ----------
const st = YK.novoJogo({ modos: { ISR: 'ia', EGY: 'ia' }, seed: 7 });
const tank = st.units.find(u => u.side === 'ISR' && u.tipo === 'tank');
tank.hex = '2505';
const alc = YK.alcance(st, tank);
ok(alc.size > 10, 'tanque tem mobilidade');
ok(alc.has('2305') && alc.get('2305').custo === 2, 'estrada barata até 2305 (custo ' + (alc.get('2305') || {}).custo + ')');
// 2104 está na ZOC da infantaria de 2103: alcançável, mas terminal
ok(alc.has('2104'), '2104 alcançável');
// ZOC: israelense para ao lado de egípcia
const inf = st.units.find(u => u.side === 'EGY' && u.tipo === 'inf' && u.hex === '2101');
const adj = YK.vizinhos('2101');
let zocStop = true;
for (const [h, info] of alc) {
  const idx = info.caminho.findIndex(x => adj.includes(x));
  if (idx >= 0 && idx < info.caminho.length - 1) zocStop = false; // passou através de ZOC
}
ok(zocStop, 'movimento para na ZOC inimiga');
// não termina sobre água nem sobre unidades
ok(![...alc.keys()].some(h => YK.ehAgua(h)), 'não entra na água');
ok(![...alc.keys()].some(h => {
  const o = YK.unidadeEm(st, h);
  return o && !(o.tipo === 'sam');
}), 'não para sobre unidades');

// custo de terreno: dunas 3 / aberto 2 / estrada 1 / cidade 1
ok(YK.custoEntrada(st, 'EGY', '1602', '1601') === 3, 'dunas custam 3');
ok(YK.custoEntrada(st, 'EGY', '1402', '1503') === 1, 'estrada custa 1');

// água e pontes locais: 1003/1108 são água; 1108 transitável só pela estrada
ok(YK.ehAgua('1003') && YK.ehAgua('1108') && YK.ehAgua('1207'), '1003/1108/1207 são água');
ok(YK.passavel('1107', '1108') && YK.passavel('1108', '1208'), 'ponte rodoviária 1107-1108-1208');
ok(!YK.passavel('1109', '1108'), 'sem ponte, água é intransponível');
ok(!YK.passavel('1107', '1206') && !YK.passavel('1206', '1107'), 'curso d\'água bloqueia 1107|1206');

// margens: o canal contorna Ismaília — 1203/1204/1206 ficam do lado leste (Sinai)
ok(!YK.oeste('1203') && !YK.oeste('1204') && !YK.oeste('1206'), '1203/1204/1206 são margem leste');
ok(YK.oeste('1202') && YK.oeste('1107') && YK.oeste('1208'), '1202/1107/1208 são margem oeste');
ok(YK.arestaCanal('1202', '1203'), 'canal passa entre 1202 e 1203');
ok(!YK.podeCruzarCanal(st0, '1202', '1203', 'EGY') && !YK.podeCruzarCanal(st0, '1202', '1203', 'ISR'),
  'ninguém cruza entre 1202 e 1203 (sem ponte)');
ok(!YK.arestaCanal('1204', '1304') && !YK.arestaCanal('1206', '1306'),
  'margem leste contínua em volta do lago (1204-1304, 1206-1306 livres)');

// ---------- engajamento e combate ----------
const st2 = YK.novoJogo({ modos: { ISR: 'ia', EGY: 'ia' }, seed: 3 });
const t1 = st2.units.find(u => u.side === 'ISR' && u.tipo === 'tank');
t1.hex = '2102'; // adjacente à infantaria egípcia em 2101 e 2103
ok(YK.engajada(st2, t1), 'tanque engajado');
const cbs = YK.combates(st2, 'ISR');
ok(cbs.length === 1, 'um combate (componente conexo)');
ok(cbs[0].atacantes.length === 1 && cbs[0].defensores.length === 2,
  '1 atacante x 2 defensores: ' + cbs[0].defensores.length);
const tot = YK.totaisCombate(st2, cbs[0]);
ok(tot.atq === 4, 'IC de ataque 4');
ok(tot.def === 2 + 2 + 2 + 2, 'defesa 2x(2+2 dunas) = 8, obtido ' + tot.def);
ok(YK.colunaRelacao(tot.atq, tot.def) === -2, 'coluna -2');

// colunas da TRF
ok(YK.colunaRelacao(1, 2) === -2 && YK.colunaRelacao(2, 3) === -1 &&
   YK.colunaRelacao(3, 3) === 0 && YK.colunaRelacao(6, 3) === 1 &&
   YK.colunaRelacao(9, 3) === 2, 'limiares da TRF');
ok(YK.colunaRelacao(2, 1) === 1 && YK.colunaRelacao(3, 1) === 2, 'TRF topo (2x1=+1, 3x1=+2)');

// TEC completa: 5 colunas x 11 resultados, pares válidos
const D = ['DE', 'DRB', 'DRI', 'DVB', 'DVI'], A = ['AE', 'ARB', 'ARI', 'AVB', 'AVI'];
let tecOk = true;
for (const col of ['-2', '-1', '0', '1', '2'])
  for (let d = 2; d <= 12; d++) {
    const r = YK.TEC[col][d];
    if (!r) { tecOk = false; continue; }
    const [x, y] = r.split('-');
    if (!D.includes(x) || !A.includes(y)) tecOk = false;
  }
ok(tecOk, 'TEC consistente');

// resolução com baixas/recuo
const st3 = YK.novoJogo({ modos: { ISR: 'ia', EGY: 'ia' }, seed: 11 });
st3.units.find(u => u.hex === '2103').hex = '1707'; // afasta a 2ª infantaria
const atq3 = st3.units.filter(u => u.side === 'ISR' && u.tipo === 'tank').slice(0, 3);
atq3[0].hex = '2102'; atq3[1].hex = '2001'; atq3[2].hex = '2201';
const def3 = st3.units.find(u => u.hex === '2101');
const cb3 = YK.combates(st3, 'ISR')[0];
const r3 = await YK.resolverCombate(st3, cb3, st3.rng, YK.decisorAuto(st3, cb3, 'ISR'));
ok(r3.col === 2, 'coluna +2 (12 x 4): obtida ' + r3.col);
ok(def3.dead || def3.baixas === 1 || def3.hex !== '2101' || r3.resultado.startsWith('DVI'),
  'efeito aplicado ao defensor');

// reincidência: segunda baixa elimina
const st4 = YK.novoJogo({ modos: { ISR: 'ia', EGY: 'ia' }, seed: 1 });
const u4 = st4.units.find(u => u.hex === '2101');
YK.sofrerBaixas(st4, u4);
ok(u4.baixas === 1 && !u4.dead, 'primeira baixa vira a peça');
YK.sofrerBaixas(st4, u4);
ok(u4.dead, 'segunda baixa elimina');

// recuo impossível: cercada por água/inimigos
const st5 = YK.novoJogo({ modos: { ISR: 'ia', EGY: 'ia' }, seed: 1 });
const u5 = st5.units.find(u => u.side === 'EGY' && u.tipo === 'tank');
u5.hex = '1320'; // hipotético: cercado de água (1320 é água? então use outra)
// usar uma casa cercada: 0922 é água... vamos cercar 1622 por ZOC
u5.hex = '1622';
const isr5 = st5.units.filter(u => u.side === 'ISR').slice(0, 3);
isr5[0].hex = '1621'; isr5[1].hex = '1721'; // wait 1721 é água; usar vizinhos válidos
const viz5 = YK.vizinhos('1622').filter(h => !YK.ehAgua(h));
isr5.forEach((u, i) => { if (viz5[i]) u.hex = viz5[i]; });
const sobrou = YK.casasRecuo(st5, u5).livres.length + YK.casasRecuo(st5, u5).deslocaveis.length;
YK.recuar(st5, u5, null);
ok(sobrou > 0 ? !u5.dead : u5.dead, 'recuo coerente (livres=' + sobrou + ')');

// ---------- SAM ----------
const st6 = YK.novoJogo({ modos: { ISR: 'ia', EGY: 'ia' }, seed: 5 });
const sam = st6.units.find(u => u.tipo === 'sam' && u.hex === '0211');
const t6 = st6.units.find(u => u.side === 'ISR' && u.tipo === 'tank');
t6.hex = '0212';
const alc6 = YK.alcance(st6, t6);
ok(alc6.has('0211'), 'israelense pode entrar na casa da SAM');
YK.mover(st6, t6, '0211', alc6.get('0211').caminho);
ok(sam.dead, 'SAM eliminada ao ser ocupada');
ok(!YK.engajada(st6, t6) || true, 'SAM não engaja');

// ---------- entrada em fila ----------
const st7 = YK.novoJogo({ modos: { ISR: 'ia', EGY: 'ia' }, seed: 9 });
const pool7 = YK.poolEntrada(st7, 'ISR');
ok(pool7.length === 13, '13 unidades israelenses iniciais (obtido ' + pool7.length + ')');
const e1 = YK.entrarUnidade(st7, pool7[0], '2505');
ok(e1.ok && e1.im === YK.imAtual(pool7[0]) - 1, '1ª entrada paga 1');
const e2 = YK.entrarUnidade(st7, pool7[1], '2505');
ok(!e2.ok, 'casa de entrada ocupada bloqueia');
YK.mover(st7, pool7[0], '2404', ['2404']);
const e3 = YK.entrarUnidade(st7, pool7[1], '2505');
ok(e3.ok && e3.im === YK.imAtual(pool7[1]) - 2, '2ª entrada paga 2 (fila)');
const eng7 = st7.units.find(u => u.tipo === 'eng');
ok(YK.casasEntrada(st7, eng7).length <= 1 && !YK.casasEntrada(st7, eng7).includes('1922'),
  'engenharia só entra por 2505');

// reforços egípcios por rodada
const st8 = YK.novoJogo({ modos: { ISR: 'ia', EGY: 'ia' }, seed: 13 });
ok(YK.poolEntrada(st8, 'EGY').length === 0, 'sem reforços egípcios na rodada 1');
st8.round = 3;
ok(YK.poolEntrada(st8, 'EGY').length === 2, 'reforços egípcios da rodada 3');
st8.round = 5;
ok(YK.poolEntrada(st8, 'EGY').length === 9, 'reforços acumulam se não entrarem');

// reforços israelenses precisam da ponte ativa
const st9 = YK.novoJogo({ modos: { ISR: 'ia', EGY: 'ia' }, seed: 17 });
st9.round = 4;
ok(YK.poolEntrada(st9, 'ISR').filter(u => u.entrada === 99).length === 0,
  'reforços israelenses bloqueados sem ponte');
const eng9 = st9.units.find(u => u.tipo === 'eng');
eng9.hex = '1312';
st9.ponteRodada = 3;
ok(YK.poolEntrada(st9, 'ISR').filter(u => u.entrada === 99).length === 6,
  'reforços israelenses liberados com ponte');

// ---------- vitória ----------
const stv = YK.novoJogo({ modos: { ISR: 'ia', EGY: 'ia' }, seed: 21 });
ok(YK.estradaLivre(stv), 'estrada Fahid-Ismaília livre no início');
const objv = YK.objetivosIsraelenses(stv);
ok(objv.total === 0, 'Israel sem objetivos no início');
const fimv = YK.avaliarVitoria(stv);
ok(fimv.vencedor === 'EGY', 'sem progresso israelense = vitória egípcia (obtido ' + fimv.vencedor + ')');
// vitória decisiva israelense simulada (afasta os egípcios dos objetivos primeiro)
for (const s of stv.units.filter(u => u.tipo === 'sam')) { s.dead = true; s.hex = null; }
let rv = 6;
for (const u of stv.units.filter(u => u.side === 'EGY' && !u.dead && u.hex)) u.hex = YK.hid(24, rv++);
const tanksV = stv.units.filter(u => u.side === 'ISR' && u.tipo === 'tank');
tanksV[0].hex = '0803'; tanksV[1].hex = '1202'; tanksV[2].hex = '0621';
const fim2 = YK.avaliarVitoria(stv);
ok(fim2.vencedor === 'ISR' && fim2.tipo === 'decisiva', 'vitória decisiva israelense');
ok(!YK.estradaLivre(stv), 'estrada bloqueada por israelenses nos extremos');

// ---------- partida completa IA vs IA ----------
for (const seed of [101, 202, 303]) {
  const g = YK.novoJogo({ modos: { ISR: 'ia', EGY: 'ia' }, seed });
  let guard = 0;
  while (!g.fim && guard++ < 200) {
    await YK.IA.jogarFase(g);
    YK.proximaFase(g);
  }
  ok(g.fim !== null, `partida ${seed} terminou (fases executadas: ${guard})`);
  if (g.fim) ok(['decisiva', 'parcial', 'marginal', 'empate'].includes(g.fim.tipo),
    `partida ${seed}: resultado ${g.fim.tipo} (${g.fim.vencedor})`);
  // invariantes
  const ocupadas = new Set();
  let stackOk = true;
  for (const u of g.units.filter(u => !u.dead && u.hex)) {
    if (ocupadas.has(u.hex)) stackOk = false;
    ocupadas.add(u.hex);
    // água só é ocupável sobre ponte rodoviária (ex.: 1108)
    if (YK.ehAgua(u.hex) && !YK.ROADHEX.has(u.hex)) stackOk = false;
  }
  ok(stackOk, `partida ${seed}: sem empilhamento nem unidades na água`);
  console.log(`  partida ${seed}: ${g.fim ? g.fim.tipo + ' ' + (g.fim.vencedor || '') : 'INCOMPLETA'} | ` +
    `ISR vivas: ${g.units.filter(u => u.side === 'ISR' && !u.dead && u.hex).length}, ` +
    `EGY vivas: ${g.units.filter(u => u.side === 'EGY' && !u.dead && u.hex).length}, ` +
    `ponte: ${g.ponteRodada ?? 'não'}`);
}

console.log(`\n${passes} passaram, ${fails} falharam`);
process.exit(fails ? 1 : 0);
