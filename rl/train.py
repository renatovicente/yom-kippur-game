#!/usr/bin/env python3
"""Treinador PPO para A Guerra do Yom Kippur.

Coleta experiência em workers Node (rl/worker.mjs, ambientes vetorizados sobre
o motor real do jogo) e treina uma política com máscara de ações em PyTorch.

Uso típico:
  python3 rl/train.py --side ISR --updates 200 --procs 6 --envs 4
  python3 rl/train.py --side EGY --updates 200
  python3 rl/train.py --run meu_teste --updates 10 --procs 2 --envs 2  # fumaça

Saídas em rl/runs/<run>/:
  metrics.jsonl     — uma linha por update (perdas, recompensa, vitórias)
  dashboard.html    — gráficos de evolução (regenerado a cada avaliação)
  ckpt_XXXX.pt      — checkpoints periódicos
  policy.json       — pesos exportados p/ inferência em JS (rl/play-checkpoint.mjs)
"""
import argparse, base64, glob, json, math, os, subprocess, sys, time
from collections import deque

import numpy as np
import torch
import torch.nn as nn

import sys as _sys, os as _os
_sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import rl.nets as nets

RAIZ = os.path.dirname(os.path.abspath(__file__))
PESO_VITORIA = {"decisiva": 1.0, "parcial": 0.6, "marginal": 0.3, "empate": 0.0}


# ---------------------------------------------------------------- workers
class PoolWorkers:
    """M processos Node, cada um com K ambientes; passo em lockstep."""

    def __init__(self, procs, envs, side, seed0, cfg_op=None):
        self.procs, self.envs = procs, envs
        self.n = procs * envs
        self.ps = []
        for i in range(procs):
            p = subprocess.Popen(
                ["node", os.path.join(RAIZ, "worker.mjs")],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
                bufsize=1, cwd=RAIZ)
            self._envia(p, {"cmd": "init", "n": envs, "side": side,
                            "seed0": seed0 + i * 100000, **(cfg_op or {})})
            ini = self._recebe(p)
            self.obs_tam, self.n_acoes = ini["obs"], ini["acoes"]
            self.ps.append(p)

    def _envia(self, p, msg):
        p.stdin.write(json.dumps(msg) + "\n")

    def _recebe(self, p):
        ln = p.stdout.readline()
        if not ln:
            raise RuntimeError("worker morreu")
        d = json.loads(ln)
        if "erro" in d:
            raise RuntimeError("worker: " + d["erro"][:500])
        return d

    def _decodifica(self, lotes):
        obs = np.concatenate([
            np.frombuffer(base64.b64decode(l["obs"]), dtype=np.float32)
              .reshape(self.envs, self.obs_tam) for l in lotes])
        mask = np.concatenate([
            np.frombuffer(base64.b64decode(l["mask"]), dtype=np.uint8)
              .reshape(self.envs, self.n_acoes) for l in lotes])
        lado = np.concatenate([np.array(l["lado"], dtype=np.int64) for l in lotes])
        rews = np.concatenate([np.array(l["rews"], dtype=np.float32) for l in lotes])
        dones = np.concatenate([np.array(l["dones"], dtype=np.float32) for l in lotes])
        phi = np.concatenate([np.array(l.get("phi", [0] * self.envs), dtype=np.float32)
                              for l in lotes])
        fins = [f for l in lotes for f in l["fins"]]
        return obs, mask, lado, rews, dones, phi, fins

    def reset(self):
        for p in self.ps:
            self._envia(p, {"cmd": "reset"})
        return self._decodifica([self._recebe(p) for p in self.ps])

    def step(self, acoes):
        for i, p in enumerate(self.ps):
            a = acoes[i * self.envs:(i + 1) * self.envs]
            self._envia(p, {"cmd": "step", "acts": [int(x) for x in a]})
        return self._decodifica([self._recebe(p) for p in self.ps])

    def fecha(self):
        for p in self.ps:
            try:
                self._envia(p, {"cmd": "quit"})
            except Exception:
                pass
            p.terminate()


# ---------------------------------------------------------------- rede
class Politica(nn.Module):
    def __init__(self, obs_tam, n_acoes, h1=256, h2=128):
        super().__init__()
        self.tronco = nn.Sequential(
            nn.Linear(obs_tam, h1), nn.Tanh(),
            nn.Linear(h1, h2), nn.Tanh())
        self.cab_pi = nn.Linear(h2, n_acoes)
        self.cab_v = nn.Linear(h2, 1)
        nn.init.orthogonal_(self.cab_pi.weight, 0.01)
        nn.init.orthogonal_(self.cab_v.weight, 1.0)

    def forward(self, obs, mask):
        z = self.tronco(obs)
        logits = self.cab_pi(z).masked_fill(mask < 0.5, -1e9)
        return logits, self.cab_v(z).squeeze(-1)

    def age(self, obs, mask, greedy=False):
        with torch.no_grad():
            logits, v = self(obs, mask)
            dist = torch.distributions.Categorical(logits=logits)
            a = logits.argmax(-1) if greedy else dist.sample()
            return a, dist.log_prob(a), v


# ---------------------------------------------------------------- treino
def age(net, obs, mask, greedy=False):
    with torch.no_grad():
        logits, v = net(obs, mask)
        dist = torch.distributions.Categorical(logits=logits)
        a = logits.argmax(-1) if greedy else dist.sample()
        return a, dist.log_prob(a), v


def gae(rews, dones, vals, ult_val, gamma, lam):
    T, N = rews.shape
    adv = np.zeros((T, N), dtype=np.float32)
    prox_adv = np.zeros(N, dtype=np.float32)
    prox_val = ult_val
    for t in range(T - 1, -1, -1):
        vivo = 1.0 - dones[t]
        delta = rews[t] + gamma * prox_val * vivo - vals[t]
        prox_adv = delta + gamma * lam * vivo * prox_adv
        adv[t] = prox_adv
        prox_val = vals[t]
    return adv, adv + vals


def exporta_json(modelo, caminho, obs_tam, n_acoes):
    pesos = {}
    sd = modelo.state_dict()
    nomes = {"tronco.0": "W1", "tronco.2": "W2", "cab_pi": "Wp", "cab_v": "Wv"}
    for k, nome in nomes.items():
        pesos[nome] = base64.b64encode(
            sd[k + ".weight"].numpy().astype(np.float32).T.copy().tobytes()).decode()
        pesos["b" + nome[1:]] = base64.b64encode(
            sd[k + ".bias"].numpy().astype(np.float32).tobytes()).decode()
    meta = {"obs": obs_tam, "acoes": n_acoes,
            "dims": [obs_tam, sd["tronco.0.weight"].shape[0],
                     sd["tronco.2.weight"].shape[0]]}
    with open(caminho, "w") as f:
        json.dump({"meta": meta, **pesos}, f)


def gera_dashboard(pasta, run, side):
    linhas = []
    mpath = os.path.join(pasta, "metrics.jsonl")
    if os.path.exists(mpath):
        with open(mpath) as f:
            linhas = [json.loads(l) for l in f if l.strip()]
    html = DASHBOARD_HTML.replace("__DADOS__", json.dumps(linhas)) \
                         .replace("__RUN__", f"{run} (lado {side})")
    with open(os.path.join(pasta, "dashboard.html"), "w") as f:
        f.write(html)


DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="15">
<title>Evolução do treino — __RUN__</title>
<style>
body{font-family:Georgia,serif;background:#efe7d2;color:#2b2418;margin:20px}
h1{border-bottom:3px double #2b2418;padding-bottom:6px}
.grade{display:grid;grid-template-columns:1fr 1fr;gap:18px;max-width:1200px}
.cartao{background:#fff;border:2px solid #2b2418;padding:10px}
.cartao h3{margin:0 0 6px;font-size:14px;text-transform:uppercase}
canvas{width:100%;height:220px}
.nota{font-size:13px;color:#555}
</style></head><body>
<h1>Evolução do treino — __RUN__</h1>
<p class="nota">Atualiza sozinho a cada 15 s enquanto o treino roda.
Taxas de vitória medidas em avaliação <i>greedy</i> contra a IA heurística.</p>
<div class="grade">
<div class="cartao"><h3>Taxa de vitória vs heurística</h3><canvas id="c_vit"></canvas></div>
<div class="cartao"><h3>Recompensa média por episódio (coleta)</h3><canvas id="c_rew"></canvas></div>
<div class="cartao"><h3>Tipos de resultado na avaliação</h3><canvas id="c_tipos"></canvas></div>
<div class="cartao"><h3>Entropia da política</h3><canvas id="c_ent"></canvas></div>
<div class="cartao"><h3>Perda de valor</h3><canvas id="c_v"></canvas></div>
<div class="cartao"><h3>Episódios coletados (acumulado)</h3><canvas id="c_eps"></canvas></div>
</div>
<script>
const D = __DADOS__;
function plota(id, series, cores, rotulos, ymin, ymax){
  const cv = document.getElementById(id);
  cv.width = cv.clientWidth*2; cv.height = cv.clientHeight*2;
  const ctx = cv.getContext('2d'); ctx.scale(2,2);
  const W = cv.clientWidth, H = cv.clientHeight, m = 28;
  const xs = D.map(d=>d.update);
  if (!xs.length) { ctx.fillText('aguardando dados…', 20, 30); return; }
  const x0 = Math.min(...xs), x1 = Math.max(...xs, x0+1);
  let lo = ymin, hi = ymax;
  if (lo===undefined){ lo=Infinity; hi=-Infinity;
    for(const s of series) for(const v of s) if(v!=null){lo=Math.min(lo,v);hi=Math.max(hi,v);}
    if(!isFinite(lo)){lo=0;hi=1;} if(hi-lo<1e-6) hi=lo+1; }
  const X=v=>m+(v-x0)/(x1-x0)*(W-2*m), Y=v=>H-m-(v-lo)/(hi-lo)*(H-2*m);
  ctx.strokeStyle='#ccc'; ctx.beginPath();
  ctx.moveTo(m,Y(lo)); ctx.lineTo(W-m,Y(lo)); ctx.moveTo(m,Y(lo)); ctx.lineTo(m,Y(hi)); ctx.stroke();
  ctx.fillStyle='#555'; ctx.font='10px Georgia';
  ctx.fillText(lo.toFixed(2), 2, Y(lo)); ctx.fillText(hi.toFixed(2), 2, Y(hi)+8);
  ctx.fillText('update '+x0, m, H-6); ctx.fillText(''+x1, W-m-20, H-6);
  series.forEach((s,si)=>{
    ctx.strokeStyle=cores[si]; ctx.lineWidth=1.6; ctx.beginPath();
    let comecou=false;
    s.forEach((v,i)=>{ if(v==null) return;
      if(!comecou){ctx.moveTo(X(xs[i]),Y(v));comecou=true;} else ctx.lineTo(X(xs[i]),Y(v));});
    ctx.stroke();
    if (rotulos){ ctx.fillStyle=cores[si]; ctx.fillText(rotulos[si], W-m-70, 14+si*12); }
  });
}
plota('c_vit', [D.map(d=>d.win_rate)], ['#1565c0'], null, 0, 1);
plota('c_rew', [D.map(d=>d.rew_medio)], ['#2e7d32'], null, -1, 1);
plota('c_tipos', [D.map(d=>d.ev_decisiva), D.map(d=>d.ev_parcial), D.map(d=>d.ev_marginal)],
      ['#b71c1c','#e65100','#f9a825'], ['decisiva','parcial','marginal'], 0, 1);
plota('c_ent', [D.map(d=>d.entropia)], ['#6a1b9a']);
plota('c_v', [D.map(d=>d.perda_v)], ['#37474f']);
plota('c_eps', [D.map(d=>d.episodios)], ['#00695c']);
</script></body></html>"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--side", default="ISR", choices=["ISR", "EGY"])
    ap.add_argument("--run", default=None)
    ap.add_argument("--updates", type=int, default=200)
    ap.add_argument("--procs", type=int, default=6)
    ap.add_argument("--envs", type=int, default=4)
    ap.add_argument("--passos", type=int, default=256, help="passos por env por update")
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--gamma", type=float, default=1.0)
    ap.add_argument("--lam", type=float, default=0.95)
    ap.add_argument("--clip", type=float, default=0.2)
    ap.add_argument("--entropia", type=float, default=0.01)
    ap.add_argument("--shaping", type=float, default=0.0,
                    help="coef. de reward shaping baseado em potencial do atacante "
                         "(Ng et al. 1999): r += coef·((1-done)·Φ(s') − Φ(s)). Só afeta ISR.")
    ap.add_argument("--epocas", type=int, default=4)
    ap.add_argument("--minibatch", type=int, default=1024)
    ap.add_argument("--eval_cada", type=int, default=5)
    ap.add_argument("--eval_eps", type=int, default=24)
    ap.add_argument("--arch", default="mlp", choices=list(nets.ARCHS))
    ap.add_argument("--width", type=int, default=0,
                    help="largura da rede (canais p/ cnn, features p/ gnn); 0 = padrão")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--resume", action="store_true",
                    help="retoma o treino do último checkpoint do run")
    ap.add_argument("--pesos", default="",
                    help="JSON com pesos da heurística {ISR:{...},EGY:{...}} (oponente)")
    ap.add_argument("--oponente", default="",
                    help='oponente fixo, ex.: \'{"tipo":"neural","modelo":"web/models/ISR_v3.json"}\'')
    ap.add_argument("--init", default="",
                    help="aquece os pesos a partir de um checkpoint .pt (aceita o "
                         "esquema antigo tronco/cab_* da Fase A e o novo l1/l2/pi/v)")
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    run = args.run or f"{args.side}_{time.strftime('%Y%m%d_%H%M%S')}"
    pasta = os.path.join(RAIZ, "runs", run)
    os.makedirs(pasta, exist_ok=True)
    mpath = os.path.join(pasta, "metrics.jsonl")

    up0, episodios_total = 0, 0
    # oponente do treino E da avaliação (mesmo nos dois, sempre)
    args.cfg_op = {}
    if args.pesos:
        args.cfg_op["pesos"] = json.load(open(args.pesos))
    if args.oponente:
        args.cfg_op["oponente"] = json.loads(args.oponente)
    if args.cfg_op:
        print(f"oponente configurado: {json.dumps(args.cfg_op)[:200]}")
    pool = PoolWorkers(args.procs, args.envs, args.side, seed0=1 + args.seed, cfg_op=args.cfg_op)
    N = pool.n
    obs_tam, n_acoes = pool.obs_tam, pool.n_acoes
    kw = {}
    if args.width:
        kw = {"c": args.width} if args.arch == "cnn" else \
             {"f": args.width} if args.arch == "gnn" else {}
    modelo = nets.cria(args.arch, **kw)
    n_params = sum(p.numel() for p in modelo.parameters())
    print(f"arquitetura {args.arch} {kw or '(padrão)'}: {n_params} parâmetros")
    if args.init:
        raw = torch.load(args.init, map_location="cpu", weights_only=True)
        sd = raw["modelo"] if isinstance(raw, dict) and "modelo" in raw else raw
        remap = {"tronco.0": "l1", "tronco.2": "l2", "cab_pi": "pi", "cab_v": "v"}
        sd2 = {}
        for k, v in sd.items():
            nk = next((b + k[len(a):] for a, b in remap.items() if k.startswith(a)), k)
            sd2[nk] = v
        modelo.load_state_dict(sd2)
        print(f"aquecido de {args.init}")
    otim = torch.optim.Adam(modelo.parameters(), lr=args.lr)

    if args.resume:
        cks = sorted(glob.glob(os.path.join(pasta, "ckpt_*.pt")))
        if cks:
            dado = torch.load(cks[-1], map_location="cpu", weights_only=False)
            if isinstance(dado, dict) and "modelo" in dado:
                modelo.load_state_dict(dado["modelo"])
                otim.load_state_dict(dado["otim"])
                up0 = dado.get("update", 0)
                episodios_total = dado.get("episodios", 0)
            else:  # checkpoints antigos: só os pesos da rede
                modelo.load_state_dict(dado)
                up0 = int(cks[-1].rsplit("_", 1)[1].split(".")[0])
            # sementes de coleta avançam para não repetir as partidas já vistas
            pool.fecha()
            pool = PoolWorkers(args.procs, args.envs, args.side,
                               seed0=1 + args.seed + up0 * 50000, cfg_op=args.cfg_op)
            print(f"retomando de {os.path.basename(cks[-1])} "
                  f"(update {up0}, {episodios_total} episódios)")
        else:
            print("aviso: --resume sem checkpoints no run; começando do zero")
    print(f"treino {run}: lado {args.side}, {N} ambientes "
          f"({args.procs}×{args.envs}), lote {N * args.passos} decisões/update")

    obs, mask, _, _, _, phi, _ = pool.reset()
    phi_prev = phi.copy()                       # Φ(s) corrente por ambiente (shaping)
    janela_fins = deque(maxlen=200)
    if args.shaping and args.side != "ISR":
        print("aviso: --shaping só afeta o atacante (ISR); ignorado para EGY")

    if up0 >= args.updates:
        print(f"nada a fazer: checkpoint já está no update {up0} >= --updates {args.updates}")
        pool.fecha(); return

    for up in range(up0 + 1, args.updates + 1):
        t0 = time.time()
        T = args.passos
        B_obs = np.zeros((T, N, obs_tam), dtype=np.float32)
        B_mask = np.zeros((T, N, n_acoes), dtype=np.float32)
        B_act = np.zeros((T, N), dtype=np.int64)
        B_logp = np.zeros((T, N), dtype=np.float32)
        B_val = np.zeros((T, N), dtype=np.float32)
        B_rew = np.zeros((T, N), dtype=np.float32)
        B_done = np.zeros((T, N), dtype=np.float32)

        for t in range(T):
            to = torch.from_numpy(obs)
            tm = torch.from_numpy(mask.astype(np.float32))
            a, logp, v = age(modelo, to, tm)
            B_obs[t], B_mask[t] = obs, mask
            B_act[t], B_logp[t], B_val[t] = a.numpy(), logp.numpy(), v.numpy()
            obs, mask, _, rews, dones, phi, fins = pool.step(a.numpy())
            if args.shaping and args.side == "ISR":
                # shaping potencial (Ng et al.): r += coef·((1-done)·Φ(s') − Φ(s)),
                # com Φ(terminal)=0; aproxima Φ(estado-de-reset)≈0 (nada conquistado).
                rews = rews + args.shaping * ((1.0 - dones) * phi - phi_prev)
                phi_prev = np.where(dones > 0.5, 0.0, phi)
            B_rew[t], B_done[t] = rews, dones
            episodios_total += len(fins)
            janela_fins.extend(fins)

        with torch.no_grad():
            _, ult_v = modelo(torch.from_numpy(obs),
                              torch.from_numpy(mask.astype(np.float32)))
        adv, ret = gae(B_rew, B_done, B_val, ult_v.numpy(), args.gamma, args.lam)
        adv = (adv - adv.mean()) / (adv.std() + 1e-8)

        fl = lambda x: torch.from_numpy(x.reshape(T * N, *x.shape[2:]))
        d_obs, d_mask = fl(B_obs), fl(B_mask)
        d_act, d_logp = fl(B_act), fl(B_logp)
        d_adv, d_ret = fl(adv), fl(ret)

        idx = np.arange(T * N)
        perdas_v, entropias = [], []
        for _ in range(args.epocas):
            np.random.shuffle(idx)
            for i0 in range(0, len(idx), args.minibatch):
                mb = torch.from_numpy(idx[i0:i0 + args.minibatch])
                logits, v = modelo(d_obs[mb], d_mask[mb])
                dist = torch.distributions.Categorical(logits=logits)
                logp = dist.log_prob(d_act[mb])
                razao = torch.exp(logp - d_logp[mb])
                a_mb = d_adv[mb]
                l_pi = -torch.min(razao * a_mb,
                                  razao.clamp(1 - args.clip, 1 + args.clip) * a_mb).mean()
                l_v = ((v - d_ret[mb]) ** 2).mean()
                ent = dist.entropy().mean()
                perda = l_pi + 0.5 * l_v - args.entropia * ent
                otim.zero_grad()
                perda.backward()
                nn.utils.clip_grad_norm_(modelo.parameters(), 0.5)
                otim.step()
                perdas_v.append(l_v.item())
                entropias.append(ent.item())

        rew_ep = [f["reward"] for f in janela_fins]
        linha = {
            "update": up,
            "episodios": episodios_total,
            "rew_medio": float(np.mean(rew_ep)) if rew_ep else None,
            "entropia": float(np.mean(entropias)),
            "perda_v": float(np.mean(perdas_v)),
            "dec_por_s": round(T * N / (time.time() - t0)),
        }

        # ---------------- avaliação greedy vs heurística ----------------
        if up % args.eval_cada == 0 or up == args.updates:
            ev = avalia(modelo, args, episodios=args.eval_eps, seed0=900000 + up)
            linha.update(ev)
            torch.save({"modelo": modelo.state_dict(), "otim": otim.state_dict(),
                        "update": up, "episodios": episodios_total},
                       os.path.join(pasta, f"ckpt_{up:04d}.pt"))
            json.dump(modelo.export_spec(), open(os.path.join(pasta, "policy.json"), "w"))

        with open(mpath, "a") as f:
            f.write(json.dumps(linha) + "\n")
        gera_dashboard(pasta, run, args.side)
        print(f"  up {up:4d} | rew {linha.get('rew_medio')} | "
              f"ent {linha['entropia']:.3f} | win {linha.get('win_rate', '—')} | "
              f"{linha['dec_por_s']} dec/s")

    pool.fecha()
    print(f"fim. dashboard: {os.path.join(pasta, 'dashboard.html')}")


def avalia(modelo, args, episodios, seed0):
    pool = PoolWorkers(2, max(2, episodios // 8), args.side, seed0=seed0,
                       cfg_op=getattr(args, "cfg_op", None))
    obs, mask, _, _, _, _, _ = pool.reset()
    fins = []
    guarda = 0
    while len(fins) < episodios and guarda < 20000:
        guarda += 1
        a, _, _ = age(modelo, torch.from_numpy(obs),
                      torch.from_numpy(mask.astype(np.float32)), greedy=True)
        obs, mask, _, _, _, _, novos = pool.step(a.numpy())
        fins.extend(novos)
    pool.fecha()
    fins = fins[:episodios]
    n = max(1, len(fins))
    vit = [f for f in fins if f["vencedor"] == args.side]
    tipos = lambda fs, t: sum(1 for f in fs if f["tipo"] == t) / n
    return {
        "win_rate": len(vit) / n,
        "ev_decisiva": tipos(vit, "decisiva"),
        "ev_parcial": tipos(vit, "parcial"),
        "ev_marginal": tipos(vit, "marginal"),
        "ev_rew": float(np.mean([f["reward"] for f in fins])) if fins else 0.0,
    }


if __name__ == "__main__":
    main()
