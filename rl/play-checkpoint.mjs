// Joga partidas com uma política treinada (policy.json: spec genérico OU formato
// MLP legado) contra a IA heurística, reusando o interpretador de ai-neural.js.
// Uso: node rl/play-checkpoint.mjs <policy.json> [episodios] [ISR|EGY]
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { YKEnv, ACAO_PASSAR } from './env.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// carrega o interpretador (depende de YK.RL, já carregado por env.mjs)
(0, eval)(readFileSync(join(root, 'web/js', 'ai-neural.js'), 'utf8'));
const YK = globalThis.YK;

const caminho = process.argv[2];
const EP = parseInt(process.argv[3] || '20', 10);
const SIDE = process.argv[4] || 'ISR';
if (!caminho) { console.error('uso: node rl/play-checkpoint.mjs <policy.json> [eps] [lado]'); process.exit(1); }

const pj = JSON.parse(readFileSync(caminho, 'utf8'));
const modelo = pj.layers ? YK.IANeural.compilaSpec(pj) : YK.IANeural.compilaLegado(pj);

function decidir(obs, mask) {
  const lg = modelo.logits(obs);
  let melhor = ACAO_PASSAR, bv = -Infinity;
  for (let a = 0; a < mask.length; a++)
    if (mask[a] && lg[a] > bv) { bv = lg[a]; melhor = a; }
  return melhor;
}

const env = new YKEnv({ side: SIDE });
const placar = {};
const t0 = Date.now();
for (let ep = 0; ep < EP; ep++) {
  let r = await env.reset(50000 + ep);
  let guarda = 0;
  while (!r.done && guarda++ < 3000) r = await env.step(decidir(r.obs, r.mask));
  const f = r.info.fim;
  const chave = f && f.vencedor ? `${f.tipo} ${f.vencedor}` : 'empate';
  placar[chave] = (placar[chave] || 0) + 1;
}
const dt = (Date.now() - t0) / 1000;
const vit = Object.entries(placar).filter(([k]) => k.endsWith(SIDE)).reduce((s, [, v]) => s + v, 0);
console.log(`${caminho} (${pj.arch || 'mlp-legado'}) jogando ${SIDE} vs heurística:`);
console.log(`  ${JSON.stringify(placar)}`);
console.log(`  vitórias: ${vit}/${EP} (${(100 * vit / EP).toFixed(0)}%) em ${dt.toFixed(1)}s`);
