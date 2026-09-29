// Worker da arena: joga partidas completas sob configurações recebidas por mensagem.
// Cada JOB = { tag, seed, agentes: {ISR: spec, EGY: spec}, pesos: {ISR:{}, EGY:{}} }.
// Specs de agente:
//   { tipo: 'heur' }                                  heurística (com os pesos do job)
//   { tipo: 'neural', modelo: 'web/models/X.json' }   política gulosa em TODAS as fases do lado
//   { tipo: 'puct', valor: 'web/models/X.json', sims, topK, prior, prof, cpuct,
//     betaHeur, tauHeur }                             busca PUCT (combate pela heurística)
import { parentPort, workerData } from 'worker_threads';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = workerData.root;
for (const f of ['map-data.js', 'units.js', 'rules.js', 'game.js', 'ai.js', 'rl-core.js', 'ai-neural.js', 'ai-mcts.js'])
  (0, eval)(readFileSync(join(ROOT, 'web/js', f), 'utf8'));
const YK = globalThis.YK;

const cacheModelos = new Map();
function compila(caminho) {
  if (!cacheModelos.has(caminho)) {
    const pj = JSON.parse(readFileSync(join(ROOT, caminho), 'utf8'));
    cacheModelos.set(caminho, pj.layers ? YK.IANeural.compilaSpec(pj) : YK.IANeural.compilaLegado(pj));
  }
  return cacheModelos.get(caminho);
}

// JSON não carrega Infinity: null / 'inf' nos pesos = Infinity
function normPesos(p) {
  const o = {};
  for (const [k, v] of Object.entries(p || {})) o[k] = (v === null || v === 'inf') ? Infinity : v;
  return o;
}

function prepara(job) {
  YK.IA.resetPesos();
  for (const lado of ['ISR', 'EGY']) if (job.pesos && job.pesos[lado]) YK.IA.setPesos(lado, normPesos(job.pesos[lado]));
  const jogador = {};
  for (const lado of ['ISR', 'EGY']) {
    const s = (job.agentes && job.agentes[lado]) || { tipo: 'heur' };
    if (s.tipo === 'heur') jogador[lado] = YK.IA;
    else if (s.tipo === 'neural') { YK.IANeural.definir(lado, compila(s.modelo), s.modelo); jogador[lado] = YK.IANeural; }
    else if (s.tipo === 'puct') {
      YK.IAMcts.setValor(lado, compila(s.valor));
      YK.IAMcts.configLado(lado, {
        simulacoes: s.sims ?? 48, topK: s.topK ?? 6, prior: s.prior ?? 'politica',
        profundidadeRodadas: s.prof ?? 4, cpuct: s.cpuct ?? 1.5,
        betaHeur: s.betaHeur ?? 0.3, tauHeur: s.tauHeur ?? 10,
      });
      jogador[lado] = YK.IAMcts;
    } else throw new Error('agente desconhecido: ' + s.tipo);
  }
  return jogador;
}

async function joga(job) {
  const jogador = prepara(job);
  const g = YK.novoJogo({ modos: { ISR: 'ia', EGY: 'ia' }, seed: job.seed });
  let gd = 0;
  while (!g.fim && gd++ < 200) {
    const f = YK.faseAtual(g);
    if (f.kind === 'resolve') await YK.resolverTudo(g, (cb, l) => YK.decisorAuto(g, cb, l));
    else await jogador[f.side].jogarFase(g);
    YK.proximaFase(g);
  }
  const fim = g.fim || { vencedor: null, tipo: 'empate', obj: { total: 0 } };
  return {
    tag: job.tag, seed: job.seed, vencedor: fim.vencedor, tipo: fim.tipo,
    obj: fim.obj ? fim.obj.total : 0,
    ponte: g.ponteRodada, ponteViva: !!YK.pontesEng(g),
    oeste: g.units.filter(u => u.side === 'ISR' && !u.dead && u.hex && YK.oeste(u.hex)).length,
    perdasISR: g.units.filter(u => u.side === 'ISR' && u.dead).length,
    perdasEGY: g.units.filter(u => u.side === 'EGY' && u.dead && u.tipo !== 'sam').length,
  };
}

parentPort.on('message', async (msg) => {
  if (msg.tipo === 'fim') { process.exit(0); }
  if (msg.tipo === 'job') {
    try { parentPort.postMessage({ tipo: 'res', res: await joga(msg.job) }); }
    catch (e) { parentPort.postMessage({ tipo: 'erro', erro: String(e && e.stack || e), job: msg.job }); }
  }
});
parentPort.postMessage({ tipo: 'pronto' });
