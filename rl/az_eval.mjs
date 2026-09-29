// Avalia specs (com cabeca de valor) jogando PUCT vs heuristica, nos dois lados.
// Uso: node rl/az_eval.mjs --isr s.json --egy s.json --jogos 10 --sims 48 --seed 8000
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['map-data.js', 'units.js', 'rules.js', 'game.js', 'ai.js', 'rl-core.js', 'ai-neural.js', 'ai-mcts.js'])
  (0, eval)(readFileSync(join(root, 'web/js', f), 'utf8'));
const YK = globalThis.YK;

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const ISR = arg('--isr'), EGY = arg('--egy');
const JOGOS = parseInt(arg('--jogos', '10'), 10);
const SIMS = parseInt(arg('--sims', '48'), 10);
const SEED = parseInt(arg('--seed', '8000'), 10);

YK.IAMcts.setValor('ISR', YK.IANeural.compilaSpec(JSON.parse(readFileSync(ISR, 'utf8'))));
YK.IAMcts.setValor('EGY', YK.IANeural.compilaSpec(JSON.parse(readFileSync(EGY, 'utf8'))));
YK.IAMcts.config({ simulacoes: SIMS, topK: 6, profundidadeRodadas: 4, cpuct: 1.5 });

async function jogar(seed, lado) {
  const g = YK.novoJogo({ modos: { ISR: 'ia', EGY: 'ia' }, seed }); let gd = 0;
  while (!g.fim && gd++ < 200) {
    const f = YK.faseAtual(g);
    if (f.kind === 'resolve') await YK.resolverTudo(g, (cb, l) => YK.decisorAuto(g, cb, l));
    else if (f.side === lado) await YK.IAMcts.jogarFase(g); else await YK.IA.jogarFase(g);
    YK.proximaFase(g);
  }
  return g.fim;
}

(async () => {
  const out = {};
  for (const lado of ['ISR', 'EGY']) {
    let w = 0;
    for (let i = 0; i < JOGOS; i++) { const f = await jogar(SEED + i, lado); if (f && f.vencedor === lado) w++; }
    out[lado] = w / JOGOS;
  }
  console.log(JSON.stringify(out));
})();
