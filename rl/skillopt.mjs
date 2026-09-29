// (4) Laço estilo SkillOpt (Microsoft) — versão leve, com NOSSO verificador.
//
// Trata o "skill document" (instruções do gerador de planos LLM) como estado
// treinável. A cada iteração:
//   ROLLOUT  — joga um lote com a skill atual; coleta scores e resumos.
//   REFLECT  — um modelo OTIMIZADOR lê vitórias/derrotas e propõe uma skill nova
//              (edição limitada — "learning rate textual").
//   GATE     — avalia a candidata em seeds HELD-OUT; aceita só se o score subir.
// Itera K vezes e salva a melhor skill. --mock roda o encanamento sem API.
//
// Uso:
//   node rl/skillopt.mjs --mock --iters 1
//   node rl/skillopt.mjs --iters 3 --lote 8 --gate 8 --model claude-haiku-4-5 \
//        --otim claude-opus-4-8 --saida rl/skills/otimizada.txt
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { configurar, avaliar } from './llm-eval.mjs';
import { chamarClaude, SKILL_DOC, carregarSkill } from './llm-planner.mjs';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const tem = (k) => process.argv.includes(k);

const MOCK = tem('--mock');
const ITERS = parseInt(arg('--iters', '2'), 10);
const LOTE = parseInt(arg('--lote', '8'), 10);        // jogos de rollout (treino)
const GATE = parseInt(arg('--gate', '8'), 10);        // jogos de validação held-out
const PROF = parseInt(arg('--prof', '2'), 10);
const MODEL = arg('--model', 'claude-haiku-4-5');     // gerador de planos (alvo)
const OTIM = arg('--otim', 'claude-opus-4-8');        // modelo otimizador (reflect)
const SAIDA = arg('--saida', join(raiz, 'rl/skills/otimizada.txt'));
const SEED_TREINO = 50000;                            // rollouts (separado da validação)
const SEED_GATE = 8000;                               // held-out (mesmo do paper)

// resume um lote em texto para o otimizador (planos escolhidos + desfecho)
function resumo(jogos) {
  return jogos.map((j, i) =>
    `Jogo ${i + 1}: ${j.venceu ? 'VITÓRIA' : 'derrota'} (${j.tipo}${j.vencedor ? ' ' + j.vencedor : ''}); ` +
    `planos por rodada: ${j.planos.join(' → ') || '(nenhum)'}`).join('\n');
}

// REFLECT: otimizador propõe nova skill (edição limitada). Mock = edição trivial.
async function refletir(skillAtual, lote) {
  if (MOCK) return skillAtual + `\n- (ajuste mock; vitórias no lote: ${lote.jogos.filter(j => j.venceu).length}/${lote.jogos.length})`;
  const vit = lote.jogos.filter(j => j.venceu), der = lote.jogos.filter(j => !j.venceu);
  const user =
    `SKILL ATUAL (instruções do gerador de planos):\n"""\n${skillAtual}\n"""\n\n` +
    `Resultados do lote (win ${(100 * lote.win).toFixed(0)}%, score ${lote.scoreMedio.toFixed(2)}):\n` +
    `VITÓRIAS:\n${resumo(vit) || '(nenhuma)'}\n\nDERROTAS:\n${resumo(der) || '(nenhuma)'}\n\n` +
    `Faça UMA edição pequena e direcionada na skill para corrigir erros recorrentes ` +
    `das derrotas SEM quebrar o que funciona nas vitórias. Não reescreva tudo.`;
  const txt = await chamarClaude({
    system: `Você otimiza um documento de instruções (skill) que guia um gerador de ` +
      `planos estratégicos para o atacante de um wargame. Responda SOMENTE com a ` +
      `skill nova completa, entre as marcas <skill> e </skill>.`,
    user, model: OTIM, max_tokens: 2000,
  });
  const m = txt.match(/<skill>([\s\S]*?)<\/skill>/);
  return m ? m[1].trim() : skillAtual;   // sem marcas válidas: mantém a atual
}

(async () => {
  mkdirSync(dirname(SAIDA), { recursive: true });
  let skill = carregarSkill(arg('--skill', null)) || SKILL_DOC;

  // baseline da skill inicial no gate held-out
  configurar({ mock: MOCK, model: MODEL, skill, prof: PROF });
  let melhorGate = await avaliar(SEED_GATE, GATE);
  console.log(`[iter 0] skill inicial — gate held-out: win ${(100 * melhorGate.win).toFixed(0)}% score ${melhorGate.scoreMedio.toFixed(3)}`);
  let skillMelhor = skill;

  for (let it = 1; it <= ITERS; it++) {
    // ROLLOUT (treino)
    configurar({ mock: MOCK, model: MODEL, skill, prof: PROF });
    const lote = await avaliar(SEED_TREINO + it * 1000, LOTE);
    // REFLECT
    const cand = await refletir(skill, lote);
    // GATE (held-out)
    configurar({ mock: MOCK, model: MODEL, skill: cand, prof: PROF });
    const g = await avaliar(SEED_GATE, GATE);
    const aceita = g.scoreMedio > melhorGate.scoreMedio + 1e-9;
    console.log(`[iter ${it}] rollout win ${(100 * lote.win).toFixed(0)}% | candidata gate ` +
      `win ${(100 * g.win).toFixed(0)}% score ${g.scoreMedio.toFixed(3)} | ${aceita ? 'ACEITA' : 'rejeitada'}`);
    if (aceita) { melhorGate = g; skill = cand; skillMelhor = cand; }
  }

  writeFileSync(SAIDA, skillMelhor);
  console.log(`\nMelhor skill (gate win ${(100 * melhorGate.win).toFixed(0)}% score ${melhorGate.scoreMedio.toFixed(3)}) salva em ${SAIDA}`);
})();
