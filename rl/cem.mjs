// CEM (cross-entropy method, gaussiana diagonal) sobre os PESOS da heurística de
// um lado, contra um oponente fixo. Aptidão = score graduado médio do lado
// otimizado. Cada geração: todos os candidatos nas MESMAS seeds (números aleatórios
// comuns), seeds novas a cada geração. Ao fim, VALIDAÇÃO em seeds nunca vistas
// contra os pesos originais, com IC de Wilson.
//
// Uso:
//   node rl/cem.mjs --lado ISR --oponente heur [--pesos-oponente arq.json] \
//        [--fixo '{"expectimax":true}'] --geracoes 12 --pop 16 --n 120 --elite 4 \
//        --nval 1000 --procs 8 --saida rl/exp/cem_isr.json
import { rodarJobs, resumir, fmtIC } from './arena.mjs';
import { readFileSync, writeFileSync } from 'fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const LADO = arg('--lado', 'ISR');
const OUTRO = LADO === 'ISR' ? 'EGY' : 'ISR';
const specOp = (v) => (!v || v === 'heur') ? { tipo: 'heur' } : JSON.parse(v);
const OPONENTE = specOp(arg('--oponente'));
// pesos do oponente: aceita objeto simples, {ISR|EGY: {...}} ou a saída de outro CEM ({final})
const RAW_OP = arg('--pesos-oponente') ? JSON.parse(readFileSync(arg('--pesos-oponente'), 'utf8')) : {};
const PESOS_OP = RAW_OP.final || RAW_OP[OUTRO] || RAW_OP;
const FIXO = arg('--fixo') ? JSON.parse(arg('--fixo')) : {};
const GER = parseInt(arg('--geracoes', '12'), 10);
const POP = parseInt(arg('--pop', '16'), 10);
const N = parseInt(arg('--n', '120'), 10);
const ELITE = parseInt(arg('--elite', '4'), 10);
const NVAL = parseInt(arg('--nval', '1000'), 10);
const PROCS = parseInt(arg('--procs', '8'), 10);
const SAIDA = arg('--saida', `rl/exp/cem_${LADO.toLowerCase()}.json`);
const SEED_BASE = parseInt(arg('--seed', '2000000'), 10);

// espaço de busca (limites) e padrão (= heurística original)
const ESPACO = {
  comum: { dist: [2, 25], alvo: [0, 200], ev: [0, 150], apoioEngaja: [0, 200],
           exposicao: [0, 100], expRazao: [1, 5], terreno: [0, 10] },
  ISR: { ponteInimigo: [0, 3], ponteEng: [0, 3], ponteObj: [0, 3], guardaPonte: [0, 4] },
  EGY: { cacaRaio: [1, 26] },                        // ≥ 25.5 => ∞ (todas caçam)
};
const PADRAO = { dist: 10, alvo: 80, ev: 65, apoioEngaja: 80, exposicao: 30, expRazao: 2,
  terreno: 2, ponteInimigo: 1, ponteEng: 0, ponteObj: 0, guardaPonte: 0, cacaRaio: 26 };
const CHAVES = [...Object.keys(ESPACO.comum), ...Object.keys(ESPACO[LADO])];
const LIM = { ...ESPACO.comum, ...ESPACO[LADO] };

const norm = (k, v) => (v - LIM[k][0]) / (LIM[k][1] - LIM[k][0]);
const denorm = (k, x) => LIM[k][0] + Math.min(1, Math.max(0, x)) * (LIM[k][1] - LIM[k][0]);
function paraPesos(x) {
  const p = { ...FIXO };
  CHAVES.forEach((k, i) => { p[k] = denorm(k, x[i]); });
  if (p.cacaRaio !== undefined && p.cacaRaio >= 25.5) p.cacaRaio = null;   // ∞
  return p;
}
function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

const scoreLado = (s) => (LADO === 'ISR' ? s.scoreISR : -s.scoreISR);
// oponente pode ser uma MISTURA {tipo:'mistura', itens:[{p, tipo, modelo?, pesos?}]}:
// o item de cada seed é sorteado deterministicamente (mesmo item p/ todos os candidatos)
function oponenteDaSeed(seed) {
  if (OPONENTE.tipo !== 'mistura') return { ag: OPONENTE, pesos: PESOS_OP };
  const tot = OPONENTE.itens.reduce((s, it) => s + it.p, 0);
  let r = ((Math.imul(seed ^ 0x9E3779B9, 2654435761) >>> 0) % 1000000) / 1000000 * tot, k = 0;
  while (k < OPONENTE.itens.length - 1 && (r -= OPONENTE.itens[k].p) > 0) k++;
  const it = OPONENTE.itens[k];
  return { ag: it.tipo === 'neural' ? { tipo: 'neural', modelo: it.modelo } : { tipo: 'heur' }, pesos: it.pesos || {} };
}
function jobsDe(pesosLado, tag, seed0, n) {
  const jobs = [];
  for (let k = 0; k < n; k++) {
    const op = oponenteDaSeed(seed0 + k);
    jobs.push({
      tag, seed: seed0 + k,
      agentes: { [LADO]: { tipo: 'heur' }, [OUTRO]: op.ag },
      pesos: { [LADO]: pesosLado, [OUTRO]: op.pesos },
    });
  }
  return jobs;
}

let melhorEver = { fit: -Infinity, x: null };            // melhor candidato individual
let mu = CHAVES.map(k => norm(k, PADRAO[k]));
let sigma = CHAVES.map(() => 0.25);
const hist = [];
const t0 = Date.now();
console.log(`CEM ${LADO} vs ${JSON.stringify(OPONENTE)} | ${CHAVES.length} parâmetros | pop ${POP}, n ${N}, ${GER} gerações`);
for (let g = 0; g < GER; g++) {
  const cands = [mu.slice()];                                  // candidato 0 = média atual
  while (cands.length < POP) cands.push(mu.map((m, i) => Math.min(1, Math.max(0, m + sigma[i] * gauss()))));
  const seed0 = SEED_BASE + g * 10000;
  const jobs = cands.flatMap((x, i) => jobsDe(paraPesos(x), i, seed0, N));
  const res = await rodarJobs(jobs, PROCS);
  const fit = cands.map((_, i) => scoreLado(resumir(res.filter(r => r.tag === i))));
  const ordem = fit.map((f, i) => [f, i]).sort((a, b) => b[0] - a[0]);
  if (ordem[0][0] > melhorEver.fit) melhorEver = { fit: ordem[0][0], x: cands[ordem[0][1]].slice(), g };
  const elite = ordem.slice(0, ELITE).map(([, i]) => cands[i]);
  const muNovo = CHAVES.map((_, j) => elite.reduce((s, x) => s + x[j], 0) / ELITE);
  const sdNovo = CHAVES.map((_, j) => Math.sqrt(elite.reduce((s, x) => s + (x[j] - muNovo[j]) ** 2, 0) / ELITE));
  mu = mu.map((m, j) => 0.3 * m + 0.7 * muNovo[j]);
  sigma = sigma.map((s, j) => Math.max(0.03, 0.3 * s + 0.7 * sdNovo[j]));
  hist.push({ g, fitMedia: fit[0], fitMelhor: ordem[0][0], pesos: paraPesos(mu) });
  console.log(`  ger ${String(g + 1).padStart(2)} | aptidão média-atual ${fit[0].toFixed(3)} | melhor ${ordem[0][0].toFixed(3)} | ` +
    `σ médio ${(sigma.reduce((a, b) => a + b, 0) / sigma.length).toFixed(3)} | ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

// validação honesta em seeds nunca vistas
const mediaFinal = paraPesos(mu);
const melhorInd = paraPesos(melhorEver.x);
const orig = paraPesos(CHAVES.map(k => norm(k, PADRAO[k])));
const vj = [...jobsDe(orig, 'orig', 9000000, NVAL), ...jobsDe(mediaFinal, 'media', 9000000, NVAL),
            ...jobsDe(melhorInd, 'melhor', 9000000, NVAL)];
const vr = await rodarJobs(vj, PROCS);
const so = resumir(vr.filter(r => r.tag === 'orig'));
const sm = resumir(vr.filter(r => r.tag === 'media')), sb = resumir(vr.filter(r => r.tag === 'melhor'));
const vitLado = s => (LADO === 'ISR' ? s.isrW : s.egyW);
// escolhe pela validação (seeds nunca vistas na otimização)
const [sc, final] = scoreLado(sb) > scoreLado(sm) ? [sb, melhorInd] : [sm, mediaFinal];
console.log(`\nVALIDAÇÃO (${NVAL} seeds novas, ${LADO} vence):`);
console.log(`  pesos originais:          ${fmtIC(vitLado(so), so.n)} | score ${scoreLado(so).toFixed(3)}`);
console.log(`  CEM média final:          ${fmtIC(vitLado(sm), sm.n)} | score ${scoreLado(sm).toFixed(3)}`);
console.log(`  CEM melhor indiv. (g${melhorEver.g + 1}): ${fmtIC(vitLado(sb), sb.n)} | score ${scoreLado(sb).toFixed(3)}`);
console.log(`  pesos CEM: ${JSON.stringify(Object.fromEntries(Object.entries(final).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(3) : v])))}`);
writeFileSync(SAIDA, JSON.stringify({ lado: LADO, oponente: OPONENTE, pesosOponente: PESOS_OP, fixo: FIXO,
  final, mediaFinal, melhorInd, hist, validacao: { original: so, media: sm, melhor: sb, escolhido: sc } }, null, 1));
console.log(`salvo em ${SAIDA} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
