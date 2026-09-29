// Auto-jogo AlphaZero: os DOIS lados jogam por busca PUCT (movimento), combate
// pela heurística. Para cada microdecisão real de movimento grava (lado, obs,
// máscara, π) onde π é a distribuição de visitas da raiz. Ao fim do jogo atribui
// o alvo de valor z (desfecho graduado, por lado) a todos os registros do lado.
// Saída: JSONL (1 registro por linha). Uso:
//   node rl/az_selfplay.mjs --isr <spec.json> --egy <spec.json> \
//        --jogos 20 --sims 24 --saida dados.jsonl --seed 70000
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['map-data.js', 'units.js', 'rules.js', 'game.js', 'ai.js', 'rl-core.js', 'ai-neural.js', 'ai-mcts.js'])
  (0, eval)(readFileSync(join(root, 'web/js', f), 'utf8'));
const YK = globalThis.YK;

// --- argumentos ---
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const ISR = arg('--isr'), EGY = arg('--egy');
const JOGOS = parseInt(arg('--jogos', '20'), 10);
const SIMS = parseInt(arg('--sims', '24'), 10);
const SAIDA = arg('--saida', join(root, 'rl/az_dados.jsonl'));
const SEED = parseInt(arg('--seed', '70000'), 10);
// se definido (ISR|EGY): só este lado busca+coleta; o oponente joga heurística.
// Dá alvos de valor BALANCEADOS (vs heurística), corrigindo o viés do auto-jogo
// lopsided que colapsa a discriminação do valor do atacante.
const SO_LADO = arg('--so_lado', '');

YK.IAMcts.setValor('ISR', YK.IANeural.compilaSpec(JSON.parse(readFileSync(ISR, 'utf8'))));
YK.IAMcts.setValor('EGY', YK.IANeural.compilaSpec(JSON.parse(readFileSync(EGY, 'utf8'))));
YK.IAMcts.config({ simulacoes: SIMS, topK: 6, profundidadeRodadas: 4, cpuct: 1.5 });

const RECOMP = { decisiva: 1.0, parcial: 0.6, marginal: 0.3, empate: 0.0 };
const b64 = (typed) => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString('base64');

// joga uma partida de auto-jogo, devolve os registros (z já preenchido)
async function umaPartida(seed) {
  const g = YK.novoJogo({ modos: { ISR: 'ia', EGY: 'ia' }, seed });
  const regs = [];
  let guarda = 0;
  while (!g.fim && guarda++ < 200) {
    const f = YK.faseAtual(g);
    if (f.kind === 'resolve') { await YK.resolverTudo(g, (cb, l) => YK.decisorAuto(g, cb, l)); YK.proximaFase(g); continue; }
    if (f.kind !== 'mov') { await YK.IA.jogarFase(g); YK.proximaFase(g); continue; }
    // oponente (quando coletamos só um lado) joga heurística, sem busca/coleta
    if (SO_LADO && f.side !== SO_LADO) { await YK.IA.jogarFase(g); YK.proximaFase(g); continue; }
    // fase de movimento do lado f.side: dirige por busca + coleta
    const lado = f.side;
    let fila = YK.RL.montarFila(g, lado), gd2 = 0;
    while (fila.length && gd2++ < 300) {
      const d = fila[0];
      const mask = YK.RL.mascaraDecisao(g, d);
      let acao = YK.RL.ACAO_PASSAR;
      if (YK.RL.temAcaoReal(mask)) {
        const tau = g.round <= 3 ? 1.0 : 0.0;     // explora cedo, decide tarde
        const obs = YK.RL.observar(g, lado);
        const { acao: a, pi } = await YK.IAMcts.analisar(g, fila, lado, { ruido: true, temperatura: tau });
        acao = a;
        regs.push({ s: lado, obs: b64(obs), mask: b64(mask), pi, z: 0 });
      }
      const { resto } = YK.RL.aplicarDecisao(g, d, acao);
      fila.shift(); if (resto) fila.unshift(resto);
    }
    YK.proximaFase(g);
  }
  // atribui z (desfecho graduado, perspectiva de cada lado)
  const fim = g.fim || { tipo: 'empate', vencedor: null };
  for (const r of regs) {
    const sinal = fim.vencedor ? (fim.vencedor === r.s ? 1 : -1) : 0;
    r.z = (RECOMP[fim.tipo] || 0) * sinal;
  }
  return { regs, fim };
}

(async () => {
  const t0 = Date.now();
  const linhas = [];
  const placar = {};
  for (let i = 0; i < JOGOS; i++) {
    const { regs, fim } = await umaPartida(SEED + i);
    for (const r of regs) linhas.push(JSON.stringify(r));
    const k = fim.vencedor ? `${fim.tipo} ${fim.vencedor}` : 'empate';
    placar[k] = (placar[k] || 0) + 1;
  }
  writeFileSync(SAIDA, linhas.join('\n') + '\n');
  console.error(`auto-jogo: ${JOGOS} partidas, ${linhas.length} registros -> ${SAIDA} ` +
    `em ${((Date.now() - t0) / 1000).toFixed(0)}s | placar ${JSON.stringify(placar)}`);
})();
