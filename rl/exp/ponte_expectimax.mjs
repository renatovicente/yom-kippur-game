// Experimento: (a) expectimax POR LADO (2×2) e (b) operação da ponte do atacante
// heurístico (local da ponte × nº de guardas da engenharia). Todas as configurações
// nas MESMAS seeds (comparação pareada). Uso: node rl/exp/ponte_expectimax.mjs [procs]
import { rodarJobs, resumir, linha } from '../arena.mjs';
import { writeFileSync } from 'fs';

const PROCS = parseInt(process.argv[2] || '6', 10);
const configs = [];

// (a) expectimax por lado
for (const ei of [true, false]) for (const ee of [true, false])
  configs.push({ grupo: 'expectimax', nome: `ISR exp=${ei ? 'on ' : 'off'} × EGY exp=${ee ? 'on ' : 'off'}`, n: 600,
    pesos: { ISR: { expectimax: ei }, EGY: { expectimax: ee } } });

// (b) ponte: regra do local × guarda
const locais = {
  'longe do inimigo (orig.)': { ponteInimigo: 1 },
  'mais perto da engenharia': { ponteInimigo: 0, ponteEng: 1 },
  'perto dos objetivos':      { ponteInimigo: 0, ponteObj: 1 },
  'misto':                    { ponteInimigo: 1, ponteEng: 0.5, ponteObj: 0.5 },
  'setor norte (8-10)':       { ponteLinhaMin: 8, ponteLinhaMax: 10 },
  'setor centro (11-13)':     { ponteLinhaMin: 11, ponteLinhaMax: 13 },
  'setor sul (14-16)':        { ponteLinhaMin: 14, ponteLinhaMax: 16 },
};
for (const [nl, p] of Object.entries(locais)) for (const g of [0, 1, 2, 3])
  configs.push({ grupo: 'ponte', nome: `${nl} | guarda ${g}`, n: 300, pesos: { ISR: { ...p, guardaPonte: g } } });

const jobs = [];
configs.forEach((c, i) => { for (let k = 0; k < c.n; k++) jobs.push({ tag: i, seed: 1000000 + k, agentes: {}, pesos: c.pesos }); });
const t0 = Date.now();
const res = await rodarJobs(jobs, PROCS);
const saida = [];
for (const grupo of ['expectimax', 'ponte']) {
  console.log(`\n== ${grupo} ==`);
  configs.forEach((c, i) => {
    if (c.grupo !== grupo) return;
    const s = resumir(res.filter(r => r.tag === i));
    console.log(linha(c.nome, s));
    saida.push({ ...c, resumo: s });
  });
}
writeFileSync(new URL('./ponte_expectimax.json', import.meta.url), JSON.stringify(saida, null, 1));
console.log(`\n${jobs.length} partidas em ${((Date.now() - t0) / 1000).toFixed(0)}s`);
