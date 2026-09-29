// Teste de paridade Python↔JS: confere que o interpretador de camadas em JS
// (web/js/ai-neural.js) produz os mesmos logits que o forward PyTorch (rl/nets.py)
// para as três arquiteturas. Casos gerados por um script Python (ver RL.md).
// Execute com: node rl/test-parity.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['map-data.js', 'units.js', 'rules.js', 'game.js', 'ai.js', 'rl-core.js', 'ai-neural.js'])
  (0, eval)(readFileSync(join(root, 'web/js', f), 'utf8'));
const YK = globalThis.YK;

const casos = JSON.parse(readFileSync(join(root, 'rl/_parity_cases.json'), 'utf8'));
let falhas = 0;
for (const c of casos) {
  const modelo = YK.IANeural.compilaSpec(c.spec);
  const obs = Float32Array.from(c.obs);
  const { logits: js, valor } = modelo.forward(obs);
  let maxerr = 0;
  for (let i = 0; i < js.length; i++) maxerr = Math.max(maxerr, Math.abs(js[i] - c.logits[i]));
  const okLog = maxerr < 1e-3;
  // paridade da cabeça de VALOR (crítico) — usada na busca PUCT
  const temValor = typeof c.valor === 'number';
  const errV = temValor ? Math.abs(valor - c.valor) : 0;
  const okVal = !temValor || errV < 1e-3;
  if (!okLog || !okVal) falhas++;
  console.log(`${okLog && okVal ? '✓' : '✗'} ${c.arch}: logits ${maxerr.toExponential(2)}` +
    (temValor ? `, valor ${errV.toExponential(2)}` : ' (sem ref. de valor)'));
}
console.log(falhas ? `\n${falhas} arquitetura(s) divergente(s)` : '\nparidade Python↔JS confirmada (logits + valor) nas 3 arquiteturas');
process.exit(falhas ? 1 : 0);
