// Avalia a IA HIERÁRQUICA (LLM/macro escolhe o plano -> micro-PUCT executa
// enviesado pelo plano) vs a heurística, em seeds held-out.
// Uso:
//   node rl/hier-eval.mjs --jogos 6 --mock                       (sem API)
//   OPENAI_API_KEY=$(cat ~/.openai_key) node rl/hier-eval.mjs --jogos 6 --model gpt-4o
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { provedorLLM, provedorMock } from './llm-planner.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['map-data.js', 'units.js', 'rules.js', 'game.js', 'ai.js', 'rl-core.js', 'ai-neural.js', 'ai-mcts.js', 'ai-macro.js', 'ai-hier.js'])
  (0, eval)(readFileSync(join(root, 'web/js', f), 'utf8'));
const YK = globalThis.YK;

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const tem = (k) => process.argv.includes(k);
const JOGOS = parseInt(arg('--jogos', '6'), 10);
const SEED = parseInt(arg('--seed', '8000'), 10);
const SIM = parseInt(arg('--sim', '24'), 10);
const MOCK = tem('--mock');
const MODEL = arg('--model', 'gpt-4o');

YK.IAHier.setValor('ISR', YK.IANeural.compilaSpec(JSON.parse(readFileSync(join(root, 'web/models/ISR_selfplay.json'), 'utf8'))));
YK.IAHier.config({ simulacoesMicro: SIM });
YK.IAHier.setProvedor(MOCK ? provedorMock(YK) : provedorLLM(YK, { model: MODEL }));

const RECOMP = { decisiva: 1.0, parcial: 0.6, marginal: 0.3, empate: 0.0 };

async function jogar(seed) {
  const g = YK.novoJogo({ modos: { ISR: 'ia', EGY: 'ia' }, seed });
  let gd = 0;
  while (!g.fim && gd++ < 200) {
    const f = YK.faseAtual(g);
    if (f.kind === 'resolve') await YK.resolverTudo(g, (cb, l) => YK.decisorAuto(g, cb, l));
    else if (f.side === 'ISR') await YK.IAHier.jogarFase(g);
    else await YK.IA.jogarFase(g);
    YK.proximaFase(g);
  }
  const fim = g.fim || { tipo: 'empate', vencedor: null };
  return { venceu: fim.vencedor === 'ISR', score: (RECOMP[fim.tipo] || 0) * (fim.vencedor === 'ISR' ? 1 : (fim.vencedor ? -1 : 0)) };
}

(async () => {
  const t0 = Date.now();
  let w = 0, soma = 0;
  for (let i = 0; i < JOGOS; i++) { const r = await jogar(SEED + i); if (r.venceu) w++; soma += r.score; }
  console.log(`HIERÁRQUICA (${MOCK ? 'MOCK' : MODEL}, microPUCT sim=${SIM}) vs heurística: ` +
    `win ${(100 * w / JOGOS).toFixed(0)}% | score ${(soma / JOGOS).toFixed(3)} | ${JOGOS} jogos em ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log('baselines (12 seeds): heur 8% | gulosa 17% | macro-fixo 17% | LLM-plano 25% | micro-PUCT 33%');
})();
