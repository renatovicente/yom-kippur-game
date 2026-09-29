// Matriz ATACANTE × DEFENSOR (win% de Israel, IC 95%) sobre as mesmas seeds.
// Uso: node rl/exp/matriz.mjs <config.json> [procs]
// config: { "n": 300, "seed0": 5000000,
//   "atacantes": { "nome": {agente ISR, "pesos": {...opcional}} },
//   "defensores": { "nome": {agente EGY, "pesos": {...opcional}} },
//   "pares": [["atq","def"], ...]   // opcional: senão, produto completo
//   "saida": "rl/exp/matriz_x.json" }
import { rodarJobs, resumir, fmtIC } from '../arena.mjs';
import { nash } from '../nash.mjs';
import { readFileSync, writeFileSync } from 'fs';

const cfg = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const PROCS = parseInt(process.argv[3] || '10', 10);
const N = cfg.n || 300, S0 = cfg.seed0 || 5000000;
const sep = (a) => { const { pesos, ...ag } = a; return { ag, pesos: pesos || {} }; };
const pares = cfg.pares || Object.keys(cfg.atacantes).flatMap(a => Object.keys(cfg.defensores).map(d => [a, d]));

const jobs = [];
for (const [a, d] of pares) {
  const A = sep(cfg.atacantes[a]), D = sep(cfg.defensores[d]);
  for (let k = 0; k < (cfg.nPar && cfg.nPar[`${a}|${d}`] || N); k++)
    jobs.push({ tag: `${a}|${d}`, seed: S0 + k, agentes: { ISR: A.ag, EGY: D.ag }, pesos: { ISR: A.pesos, EGY: D.pesos } });
}
const t0 = Date.now();
let ultimo = 0;
const res = await rodarJobs(jobs, PROCS, (k, tot) => {
  if (Date.now() - ultimo > 60000) { ultimo = Date.now(); console.error(`  ${k}/${tot} partidas (${((Date.now() - t0) / 1000).toFixed(0)}s)`); }
});
const tabela = {};
for (const [a, d] of pares) {
  const s = resumir(res.filter(r => r.tag === `${a}|${d}`));
  tabela[`${a}|${d}`] = s;
}
const defs = [...new Set(pares.map(p => p[1]))], atqs = [...new Set(pares.map(p => p[0]))];
console.log(`\nIsrael vence (IC 95%), n por célula até ${N}:`);
console.log(['atacante \\ defensor'.padEnd(28), ...defs.map(d => d.padEnd(24))].join(' '));
for (const a of atqs) {
  console.log([a.padEnd(28), ...defs.map(d => {
    const s = tabela[`${a}|${d}`];
    return (s ? fmtIC(s.isrW, s.n) : '—').padEnd(24);
  })].join(' '));
}
// equilíbrio de Nash da população (se a matriz estiver completa)
let eq = null;
if (atqs.every(a => defs.every(d => tabela[`${a}|${d}`]))) {
  const M = atqs.map(a => defs.map(d => tabela[`${a}|${d}`].isrW / tabela[`${a}|${d}`].n));
  eq = nash(M);
  const mist = (nomes, p) => nomes.map((n, i) => [n, p[i]]).filter(([, x]) => x > 0.01)
    .map(([n, x]) => `${n} ${(100 * x).toFixed(0)}%`).join(', ');
  console.log(`\nNASH da população: Israel vence ${(100 * eq.valor).toFixed(1)}% ` +
    `(gap ${(100 * Math.max(eq.explorIsr, eq.explorEgy)).toFixed(1)} pp)`);
  console.log(`  mistura Israel: ${mist(atqs, eq.pIsr)}`);
  console.log(`  mistura Egito:  ${mist(defs, eq.pEgy)}`);
}
if (cfg.saida) writeFileSync(cfg.saida, JSON.stringify({ cfg, tabela, nash: eq, atqs, defs }, null, 1));
console.log(`\n${jobs.length} partidas em ${((Date.now() - t0) / 1000).toFixed(0)}s`);
