// (2)+(3) Avalia o atacante HÍBRIDO (planos do LLM + verificação sim/valor) vs a
// heurística, em seeds held-out. Score = win% (sinal principal) + recompensa
// graduada média (sinal denso). Suporta --mock (sem API) para validar o pipeline.
//
// Uso:
//   node rl/llm-eval.mjs --jogos 6 --mock
//   node rl/llm-eval.mjs --jogos 6 --model claude-haiku-4-5 --skill rl/skills/v2.txt
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { provedorLLM, provedorMock, carregarSkill } from './llm-planner.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['map-data.js', 'units.js', 'rules.js', 'game.js', 'ai.js', 'rl-core.js', 'ai-neural.js', 'ai-mcts.js', 'ai-macro.js'])
  (0, eval)(readFileSync(join(root, 'web/js', f), 'utf8'));
const YK = globalThis.YK;

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const tem = (k) => process.argv.includes(k);
const JOGOS = parseInt(arg('--jogos', '6'), 10);
const SEED = parseInt(arg('--seed', '8000'), 10);
const PROF = parseInt(arg('--prof', '2'), 10);
const MOCK = tem('--mock');
const MODEL = arg('--model', 'claude-haiku-4-5');
const SKILL = carregarSkill(arg('--skill', null));

YK.IAMacro.setValor('ISR', YK.IANeural.compilaSpec(JSON.parse(readFileSync(join(root, 'web/models/ISR_selfplay.json'), 'utf8'))));

// (re)configura o provedor de planos — chamado pelo laço SkillOpt a cada skill nova
export function configurar({ mock = false, model = 'claude-haiku-4-5', skill = SKILL, prof = 2 } = {}) {
  YK.IAMacro.config({ profundidade: prof });
  YK.IAMacro.setProvedor(mock ? provedorMock(YK) : provedorLLM(YK, { model, skill }));
}
configurar({ mock: MOCK, model: MODEL, skill: SKILL, prof: PROF });
export { YK };

const RECOMP = { decisiva: 1.0, parcial: 0.6, marginal: 0.3, empate: 0.0 };

export async function jogarUma(seed) {
  const g = YK.novoJogo({ modos: { ISR: 'ia', EGY: 'ia' }, seed });
  const planosEscolhidos = [];
  let gd = 0;
  // captura o plano escolhido para o resumo de trajetória (reflect do SkillOpt)
  const origLog = YK.log;
  while (!g.fim && gd++ < 200) {
    const f = YK.faseAtual(g);
    if (f.kind === 'resolve') await YK.resolverTudo(g, (cb, l) => YK.decisorAuto(g, cb, l));
    else if (f.side === 'ISR') await YK.IAMacro.jogarFase(g);
    else await YK.IA.jogarFase(g);
    YK.proximaFase(g);
  }
  const fim = g.fim || { tipo: 'empate', vencedor: null };
  const venceu = fim.vencedor === 'ISR';
  const score = (RECOMP[fim.tipo] || 0) * (venceu ? 1 : (fim.vencedor ? -1 : 0));
  // resumo: planos escolhidos (lidos do log) + desfecho
  const planosLog = g.log.filter(l => /Plano escolhido/.test(l)).map(l => l.replace(/.*escolhido: /, '').replace(/ \(valor.*/, ''));
  return { venceu, score, tipo: fim.tipo, vencedor: fim.vencedor, planos: planosLog };
}

// roda um lote; devolve win%, score médio e resumos de trajetória
export async function avaliar(seed0, n) {
  const jogos = [];
  let w = 0, soma = 0;
  for (let i = 0; i < n; i++) {
    const r = await jogarUma(seed0 + i);
    jogos.push(r); if (r.venceu) w++; soma += r.score;
  }
  return { win: w / n, scoreMedio: soma / n, jogos };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const t0 = Date.now();
  const r = await avaliar(SEED, JOGOS);
  console.log(`HÍBRIDO (${MOCK ? 'MOCK' : MODEL}, prof=${PROF}) vs heurística: ` +
    `win ${(100 * r.win).toFixed(0)}% | score médio ${r.scoreMedio.toFixed(3)} ` +
    `| ${JOGOS} jogos em ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log('baselines (mesmo seed-set): heurística 8%, gulosa 17%, macro-fixo 17%, micro-PUCT 33%');
}
