// Worker vetorizado: roda K ambientes e fala JSON-lines no stdin/stdout.
// Protocolo:
//   {"cmd":"init","n":8,"side":"ISR","seed0":1000}   -> {"ok":true,...}
//   {"cmd":"reset"}                                   -> lote inicial
//   {"cmd":"step","acts":[a0..aK-1]}                  -> lote seguinte
// Lote: {"obs":b64(f32[K*OBS]), "mask":b64(u8[K*N_ACOES]), "lado":[0|1...],
//        "rews":[...], "dones":[...], "fins":[{tipo,vencedor,decisoes,seed}]}
// Ambientes terminados são reiniciados automaticamente com a próxima semente.
import { createInterface } from 'readline';
import { YKEnv, OBS_TAM, N_ACOES, configurarOponente } from './env.mjs';

let envs = [], seeds = [], proxSeed = 0, ladoCfg = 'ISR';

function b64f32(arrs) {
  const out = new Float32Array(arrs.length * OBS_TAM);
  arrs.forEach((a, i) => out.set(a, i * OBS_TAM));
  return Buffer.from(out.buffer).toString('base64');
}
function b64u8(arrs) {
  const out = new Uint8Array(arrs.length * N_ACOES);
  arrs.forEach((a, i) => out.set(a, i * N_ACOES));
  return Buffer.from(out.buffer).toString('base64');
}

async function lote(resultados, fins, phis) {
  return {
    obs: b64f32(resultados.map(r => r.obs)),
    mask: b64u8(resultados.map(r => r.mask)),
    lado: resultados.map(r => (r.lado === 'ISR' ? 0 : 1)),
    rews: resultados.map(r => r.reward),
    dones: resultados.map(r => (r.done ? 1 : 0)),
    phi: phis || resultados.map(() => 0),   // potencial do atacante (shaping); aditivo
    fins,
  };
}

const rl = createInterface({ input: process.stdin, terminal: false });
let cadeia = Promise.resolve();          // serializa o processamento das linhas
rl.on('line', (linha) => { cadeia = cadeia.then(() => tratar(linha)); });

async function tratar(linha) {
  let msg;
  try { msg = JSON.parse(linha); } catch { return; }
  try {
    if (msg.cmd === 'init') {
      ladoCfg = msg.side || 'ISR';
      proxSeed = msg.seed0 || 1;
      configurarOponente({ pesos: msg.pesos, oponente: msg.oponente, ladoTreino: ladoCfg });
      envs = Array.from({ length: msg.n || 8 }, () => new YKEnv({ side: ladoCfg }));
      seeds = envs.map(() => 0);
      process.stdout.write(JSON.stringify({ ok: true, n: envs.length, obs: OBS_TAM, acoes: N_ACOES }) + '\n');
    } else if (msg.cmd === 'reset') {
      const rs = [], phis = [];
      for (let i = 0; i < envs.length; i++) {
        seeds[i] = proxSeed++;
        rs.push(await envs[i].reset(seeds[i]));
        phis.push(envs[i].potencialAtacante());
      }
      process.stdout.write(JSON.stringify(await lote(rs, [], phis)) + '\n');
    } else if (msg.cmd === 'step') {
      const rs = [], fins = [], phis = [];
      for (let i = 0; i < envs.length; i++) {
        let r = await envs[i].step(msg.acts[i]);
        phis.push(envs[i].potencialAtacante());   // Φ(s') antes de eventual reset
        if (r.done) {
          const f = r.info.fim;
          fins.push({ i, tipo: f.tipo, vencedor: f.vencedor,
                      decisoes: r.info.decisoes, seed: seeds[i], reward: r.reward });
          const recompensa = r.reward;
          seeds[i] = proxSeed++;
          const r0 = await envs[i].reset(seeds[i]);
          r = { ...r0, reward: recompensa, done: true };
        }
        rs.push(r);
      }
      process.stdout.write(JSON.stringify(await lote(rs, fins, phis)) + '\n');
    } else if (msg.cmd === 'quit') {
      // só sai depois de drenar o stdout (as linhas de lote são grandes)
      process.stdout.write('', () => process.exit(0));
    }
  } catch (e) {
    process.stdout.write(JSON.stringify({ erro: String(e && e.stack || e) }) + '\n');
  }
}
