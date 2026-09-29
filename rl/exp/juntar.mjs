// Junta resultados de várias execuções de matriz.mjs numa tabela única e calcula
// o Nash da população (só sobre linhas/colunas com matriz completa).
// Uso: node rl/exp/juntar.mjs saida.json a_res.json b_res.json ...
//      [--atq "A,B,C"] [--def "X,Y"]   (subconjunto e ordem opcionais)
import { readFileSync, writeFileSync } from 'fs';
import { nash } from '../nash.mjs';
import { fmtIC } from '../arena.mjs';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const atqSel = opt('--atq'), defSel = opt('--def');
const [saida, ...arqs] = args;
const tabela = {};
const ordemA = [], ordemD = [];
for (const f of arqs) {
  const r = JSON.parse(readFileSync(f, 'utf8'));
  for (const [k, s] of Object.entries(r.tabela)) {
    tabela[k] = s;                                   // arquivos posteriores sobrescrevem
    const [a, d] = k.split('|');
    if (!ordemA.includes(a)) ordemA.push(a);
    if (!ordemD.includes(d)) ordemD.push(d);
  }
}
let A = atqSel ? atqSel.split(',') : ordemA;
let D = defSel ? defSel.split(',') : ordemD;
console.log('Israel vence (IC 95%):');
console.log(['atacante \\ defensor'.padEnd(30), ...D.map(d => d.slice(0, 22).padEnd(23))].join(''));
for (const a of A) console.log([a.slice(0, 29).padEnd(30), ...D.map(d => {
  const s = tabela[`${a}|${d}`];
  return (s ? fmtIC(s.isrW, s.n) : '—').padEnd(23);
})].join(''));

// Nash sobre a maior submatriz completa (remove iterativamente quem tem buracos)
const completa = (a, d) => !!tabela[`${a}|${d}`];
let mudou = true;
while (mudou) {
  mudou = false;
  const faltaA = A.map(a => D.filter(d => !completa(a, d)).length);
  const faltaD = D.map(d => A.filter(a => !completa(a, d)).length);
  const mA = Math.max(...faltaA, 0), mD = Math.max(...faltaD, 0);
  if (mA === 0 && mD === 0) break;
  if (mA >= mD) A = A.filter((_, i) => faltaA[i] !== mA); else D = D.filter((_, i) => faltaD[i] !== mD);
  mudou = true;
}
const M = A.map(a => D.map(d => tabela[`${a}|${d}`].isrW / tabela[`${a}|${d}`].n));
const eq = nash(M);
const mist = (nomes, p) => nomes.map((n, i) => [n, p[i]]).filter(([, x]) => x > 0.01)
  .map(([n, x]) => `${n} ${(100 * x).toFixed(0)}%`).join(', ');
console.log(`\nNASH (${A.length}×${D.length}): Israel vence ${(100 * eq.valor).toFixed(1)}% ` +
  `(gap ${(100 * Math.max(eq.explorIsr, eq.explorEgy)).toFixed(1)} pp)`);
console.log(`  Israel: ${mist(A, eq.pIsr)}`);
console.log(`  Egito:  ${mist(D, eq.pEgy)}`);
// melhor resposta de cada lado contra a mistura do outro (quem mais explora o Nash)
const brA = A.map((a, i) => [a, M[i].reduce((s, v, j) => s + v * eq.pEgy[j], 0)]).sort((x, y) => y[1] - x[1]);
const brD = D.map((d, j) => [d, M.reduce((s, row, i) => s + row[j] * eq.pIsr[i], 0)]).sort((x, y) => x[1] - y[1]);
console.log(`  contra a mistura egípcia, melhor atacante: ${brA[0][0]} (${(100 * brA[0][1]).toFixed(1)}%)`);
console.log(`  contra a mistura israelense, melhor defensor: ${brD[0][0]} (Israel ${(100 * brD[0][1]).toFixed(1)}%)`);
writeFileSync(saida, JSON.stringify({ tabela, A, D, M, nash: eq }, null, 1));
