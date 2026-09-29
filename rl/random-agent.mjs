// Smoke test do ambiente: agente aleatório vs IA heurística, dos dois lados.
// Execute com: node rl/random-agent.mjs [episodios]
import { YKEnv, ACAO_PASSAR, N_ACOES, OBS_TAM } from './env.mjs';

const EP = parseInt(process.argv[2] || '6', 10);

function escolherAleatoria(mask, rnd) {
  const legais = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) legais.push(i);
  return legais[Math.floor(rnd() * legais.length)];
}

let semente = 12345;
const rnd = () => { semente = (semente * 48271) % 2147483647; return semente / 2147483647; };

for (const side of ['ISR', 'EGY']) {
  const env = new YKEnv({ side });
  const placar = {};
  let totDec = 0;
  const t0 = Date.now();
  for (let ep = 0; ep < EP; ep++) {
    let r = await env.reset(1000 + ep);
    let guarda = 0;
    while (!r.done && guarda++ < 5000) {
      r = await env.step(escolherAleatoria(r.mask, rnd));
    }
    if (!r.done) { console.error('  episódio não terminou!'); process.exit(1); }
    const f = r.info.fim;
    const chave = f.vencedor ? `${f.tipo} ${f.vencedor}` : 'empate';
    placar[chave] = (placar[chave] || 0) + 1;
    totDec += r.info.decisoes;
  }
  const dt = (Date.now() - t0) / 1000;
  console.log(`política aleatória jogando ${side}: ${JSON.stringify(placar)}`);
  console.log(`  ${EP} episódios em ${dt.toFixed(1)}s ` +
    `(${(EP / dt).toFixed(1)} ep/s, ~${Math.round(totDec / EP)} decisões/ep, obs=${OBS_TAM} floats, ações=${N_ACOES})`);
}
