// ARENA: avaliação paralela e estatisticamente honesta (resolve o problema de
// n=12 com IC de ±25 pp). Distribui partidas numa fila dinâmica entre N workers
// (worker_threads) e agrega com intervalo de Wilson a 95%.
//
// CLI:
//   node rl/arena.mjs --isr '{"tipo":"puct","valor":"web/models/ISR_selfplay.json"}' \
//                     --egy heur --n 300 --seed0 100000 --procs 10 [--pesos pesos.json]
// Biblioteca: rodarJobs(jobs, procs), avaliar({agentes, pesos, n, seed0, procs}), resumir(res)
import { Worker } from 'worker_threads';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import os from 'os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RECOMP = { decisiva: 1.0, parcial: 0.6, marginal: 0.3, empate: 0.0 };

export function wilson(w, n) {
  if (!n) return [0, 0, 0];
  const p = w / n, z = 1.96, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [p, Math.max(0, c - h), Math.min(1, c + h)];
}
export const fmtIC = (w, n) => { const [p, lo, hi] = wilson(w, n); return `${(100 * p).toFixed(1)}% [${(100 * lo).toFixed(1)}–${(100 * hi).toFixed(1)}]`; };

// executa jobs numa fila dinâmica; devolve os resultados (na ordem em que chegam)
export function rodarJobs(jobs, procs = Math.max(1, os.cpus().length - 1), onProgresso) {
  return new Promise((resolve, reject) => {
    const fila = jobs.slice();
    const res = [];
    let vivos = 0;
    const n = Math.min(procs, fila.length || 1);
    if (!fila.length) return resolve(res);
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./arena-worker.mjs', import.meta.url), { workerData: { root: ROOT } });
      vivos++;
      const proximo = () => {
        if (fila.length) w.postMessage({ tipo: 'job', job: fila.shift() });
        else w.postMessage({ tipo: 'fim' });
      };
      w.on('message', (m) => {
        if (m.tipo === 'pronto') proximo();
        else if (m.tipo === 'res') { res.push(m.res); if (onProgresso) onProgresso(res.length, jobs.length); proximo(); }
        else if (m.tipo === 'erro') { reject(new Error(`job ${JSON.stringify(m.job.tag)} seed ${m.job.seed}: ${m.erro}`)); }
      });
      w.on('error', reject);
      w.on('exit', () => { if (--vivos === 0) resolve(res); });
    }
  });
}

// resumo de uma lista de resultados (perspectiva de Israel)
export function resumir(res) {
  const n = res.length;
  const wI = res.filter(r => r.vencedor === 'ISR').length;
  const wE = res.filter(r => r.vencedor === 'EGY').length;
  const score = res.reduce((s, r) => s + (RECOMP[r.tipo] || 0) * (r.vencedor === 'ISR' ? 1 : r.vencedor ? -1 : 0), 0) / Math.max(1, n);
  const tipos = {};
  for (const r of res) { const k = r.vencedor ? `${r.tipo} ${r.vencedor}` : 'empate'; tipos[k] = (tipos[k] || 0) + 1; }
  const med = f => res.reduce((s, r) => s + f(r), 0) / Math.max(1, n);
  return {
    n, isrW: wI, egyW: wE, isr: wilson(wI, n), egy: wilson(wE, n), scoreISR: score, tipos,
    ponte: med(r => (r.ponte ? 1 : 0)), ponteViva: med(r => (r.ponteViva ? 1 : 0)),
    oeste0: med(r => (r.oeste === 0 ? 1 : 0)), oeste: med(r => r.oeste),
    perdasISR: med(r => r.perdasISR), perdasEGY: med(r => r.perdasEGY), obj: med(r => r.obj),
  };
}

export function linha(nome, s) {
  return `${nome.padEnd(34)} ISR ${fmtIC(s.isrW, s.n)} | score ${s.scoreISR.toFixed(3)} | ` +
    `ponte ${(100 * s.ponte).toFixed(0)}% (viva ${(100 * s.ponteViva).toFixed(0)}%) | ` +
    `oeste=0 ${(100 * s.oeste0).toFixed(0)}% | n=${s.n}`;
}

export async function avaliar({ agentes, pesos, n = 300, seed0 = 100000, procs, tag = 'x' }) {
  const jobs = [];
  for (let i = 0; i < n; i++) jobs.push({ tag, seed: seed0 + i, agentes, pesos });
  return resumir(await rodarJobs(jobs, procs));
}

// ------------------------------------------------------------------ CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
  const spec = (v) => (!v || v === 'heur') ? { tipo: 'heur' } : JSON.parse(v);
  const agentes = { ISR: spec(arg('--isr')), EGY: spec(arg('--egy')) };
  const pesosArq = arg('--pesos');
  const pesos = pesosArq ? JSON.parse(readFileSync(pesosArq, 'utf8')) : undefined;
  const n = parseInt(arg('--n', '300'), 10);
  const t0 = Date.now();
  const s = await avaliar({ agentes, pesos, n, seed0: parseInt(arg('--seed0', '100000'), 10),
    procs: parseInt(arg('--procs', String(Math.max(1, os.cpus().length - 1))), 10) });
  console.log(linha(arg('--nome', `${agentes.ISR.tipo} × ${agentes.EGY.tipo}`), s) + ` | ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(JSON.stringify({ agentes, ...s }));
}
