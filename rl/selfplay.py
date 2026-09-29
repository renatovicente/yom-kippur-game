#!/usr/bin/env python3
"""Fase B — self-play em liga para A Guerra do Yom Kippur.

Treina DUAS políticas simultaneamente (ISR e EGY), cada uma podendo usar uma
arquitetura diferente (MLP/CNN/GNN), uma jogando contra a outra. Para estabilizar
(evitar o ciclo pedra-papel-tesoura) usa uma LIGA: parte dos ambientes enfrenta
versões congeladas (checkpoints antigos) do oponente; o pool pode ser semeado com
as políticas da Fase A.

Crédito de recompensa: episódios curtos com recompensa só terminal e gamma=1, logo
o retorno de toda decisão de uma partida é o resultado final (do ponto de vista do
lado). Coletamos por TRAJETÓRIA: cada decisão do lado-em-treino entra numa lista
por ambiente, fechada com o retorno terminal quando a partida acaba.

Uso:
  python3 rl/selfplay.py --arch-isr cnn --arch-egy gnn --updates 200
  python3 rl/selfplay.py --arch-isr mlp --arch-egy mlp \
        --seed-isr rl/runs/ISR_v2/ckpt_0150.pt --seed-egy rl/runs/EGY_v1/ckpt_0150.pt

Saídas em rl/runs/<run>/: metrics.jsonl, dashboard.html, ISR.json, EGY.json (specs
jogáveis no jogo), ckpt_{isr,egy}_NNNN.pt.
"""
import argparse, copy, json, os, random, time

import numpy as np
import torch
import torch.nn as nn

import sys as _sys, os as _os
_sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import rl.nets as nets
from rl.train import PoolWorkers

RAIZ = os.path.dirname(os.path.abspath(__file__))


def carrega_state(net, caminho):
    d = torch.load(caminho, map_location="cpu", weights_only=False)
    sd = d["modelo"] if isinstance(d, dict) and "modelo" in d else d
    ren = {"tronco.0": "l1", "tronco.2": "l2", "cab_pi": "pi", "cab_v": "v"}
    novo = {}
    for k, v in sd.items():
        for a, b in ren.items():
            if k.startswith(a):
                k = b + k[len(a):]
        novo[k] = v
    try:
        net.load_state_dict(novo); return True
    except Exception as e:
        print(f"  aviso: falha ao semear de {caminho}: {e}"); return False


def exporta_spec(net, caminho):
    json.dump(net.export_spec(), open(caminho, "w"))


def acoes(net, obs, mask, greedy=False):
    with torch.no_grad():
        logits, v = net(torch.from_numpy(obs), torch.from_numpy(mask.astype(np.float32)))
        dist = torch.distributions.Categorical(logits=logits)
        a = logits.argmax(-1) if greedy else dist.sample()
        return a.numpy(), dist.log_prob(a).numpy(), v.numpy()


class Agente:
    def __init__(self, arch, lr, semente=None):
        self.arch = arch
        self.net = nets.cria(arch)
        if semente and os.path.exists(semente) and carrega_state(self.net, semente):
            print(f"  {arch}: semeado de {os.path.basename(semente)}")
        self.otim = torch.optim.Adam(self.net.parameters(), lr=lr)
        self.liga = []

    def congela(self):
        self.liga.append(copy.deepcopy(self.net.state_dict()))
        if len(self.liga) > 8:
            self.liga.pop(0)

    def oponente(self):
        net = nets.cria(self.arch)
        if self.liga and random.random() > 0.25:
            net.load_state_dict(random.choice(self.liga))
        else:
            net.load_state_dict(self.net.state_dict())
        return net


# --------------------------------------------------------------- treino PPO
def ppo_update(agente, obs, mask, act, logp_old, ret, args):
    if len(ret) == 0:
        return {"perda_v": 0.0, "entropia": 0.0, "n": 0}
    val_ret = torch.from_numpy(ret)
    to = torch.from_numpy
    d_obs, d_mask = to(obs), to(mask.astype(np.float32))
    d_act, d_logp = to(act).long(), to(logp_old)
    # vantagem = retorno - valor estimado (baseline); recomputa o valor uma vez
    with torch.no_grad():
        _, v0 = agente.net(d_obs, d_mask)
    adv = val_ret - v0
    adv = (adv - adv.mean()) / (adv.std() + 1e-8)
    n = len(ret); idx = np.arange(n)
    pv, en = [], []
    for _ in range(args.epocas):
        np.random.shuffle(idx)
        for i0 in range(0, n, args.minibatch):
            mb = to(idx[i0:i0 + args.minibatch]).long()
            logits, v = agente.net(d_obs[mb], d_mask[mb])
            dist = torch.distributions.Categorical(logits=logits)
            lp = dist.log_prob(d_act[mb])
            r = torch.exp(lp - d_logp[mb]); a = adv[mb]
            l_pi = -torch.min(r * a, r.clamp(1 - args.clip, 1 + args.clip) * a).mean()
            l_v = ((v - val_ret[mb]) ** 2).mean()
            ent = dist.entropy().mean()
            agente.otim.zero_grad()
            (l_pi + 0.5 * l_v - args.entropia * ent).backward()
            nn.utils.clip_grad_norm_(agente.net.parameters(), 0.5)
            agente.otim.step()
            pv.append(l_v.item()); en.append(ent.item())
    return {"perda_v": float(np.mean(pv)), "entropia": float(np.mean(en)), "n": n}


# --------------------------------------------------------------- medição
def confronto(net_isr, net_egy, modo, args, seed0, eps=24):
    """modo 'both': net_isr vs net_egy. modo 'ISR'/'EGY': política vs heurística."""
    pool = PoolWorkers(2, max(2, eps // 8), modo, seed0=seed0)
    obs, mask, lado, _, _, _ = pool.reset()
    fins, guarda = [], 0
    while len(fins) < eps and guarda < 20000:
        guarda += 1
        acts = np.zeros(pool.n, dtype=np.int64)
        if modo == "both":
            for code, net in {0: net_isr, 1: net_egy}.items():
                idx = np.where(lado == code)[0]
                if idx.size:
                    acts[idx], _, _ = acoes(net, obs[idx], mask[idx], greedy=True)
        else:
            net = net_isr if net_isr is not None else net_egy
            acts, _, _ = acoes(net, obs, mask, greedy=True)
        obs, mask, lado, _, _, novos = pool.step(acts)
        fins.extend(novos)
    pool.fecha()
    return fins[:eps]


def winrate(fins, lado):
    n = max(1, len(fins))
    return round(sum(1 for f in fins if f["vencedor"] == lado) / n, 2)


# --------------------------------------------------------------- principal
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default=None)
    ap.add_argument("--arch-isr", default="mlp", choices=list(nets.ARCHS))
    ap.add_argument("--arch-egy", default="mlp", choices=list(nets.ARCHS))
    ap.add_argument("--seed-isr", default=None)
    ap.add_argument("--seed-egy", default=None)
    ap.add_argument("--updates", type=int, default=150)
    ap.add_argument("--procs", type=int, default=8)
    ap.add_argument("--envs", type=int, default=4)
    ap.add_argument("--passos", type=int, default=256)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--clip", type=float, default=0.2)
    ap.add_argument("--entropia", type=float, default=0.01)
    ap.add_argument("--epocas", type=int, default=4)
    ap.add_argument("--minibatch", type=int, default=1024)
    ap.add_argument("--congela_cada", type=int, default=10)
    ap.add_argument("--medir_cada", type=int, default=5)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    torch.manual_seed(args.seed); np.random.seed(args.seed); random.seed(args.seed)
    run = args.run or f"SP_{args.arch_isr}_{args.arch_egy}_{time.strftime('%H%M%S')}"
    pasta = os.path.join(RAIZ, "runs", run); os.makedirs(pasta, exist_ok=True)
    mpath = os.path.join(pasta, "metrics.jsonl")

    isr = Agente(args.arch_isr, args.lr, args.seed_isr)
    egy = Agente(args.arch_egy, args.lr, args.seed_egy)

    pool = PoolWorkers(args.procs, args.envs, "both", seed0=1 + args.seed)
    N = pool.n
    metade = N // 2
    # papel de cada ambiente: ISR-em-treino (0..metade) ou EGY-em-treino (metade..N)
    treina_isr = np.array([i < metade for i in range(N)])
    print(f"self-play {run}: ISR={args.arch_isr} × EGY={args.arch_egy}, {N} ambientes, liga ativa")

    obs, mask, lado, _, _, _ = pool.reset()

    for up in range(1, args.updates + 1):
        t0 = time.time()
        op_egy = egy.oponente()    # adversário dos ambientes que treinam ISR
        op_isr = isr.oponente()    # adversário dos ambientes que treinam EGY
        traj = [[] for _ in range(N)]                 # transições do lado-em-treino por ambiente
        coleta = {"ISR": [], "EGY": []}               # (obs,mask,act,logp,retorno) fechadas

        for t in range(args.passos):
            acts = np.zeros(N, dtype=np.int64)
            for code, eLado in ((0, "ISR"), (1, "EGY")):
                idx = np.where(lado == code)[0]
                if not idx.size:
                    continue
                # quais usam a rede em treino, quais usam o oponente congelado
                treino_idx = idx[treina_isr[idx]] if eLado == "ISR" else idx[~treina_isr[idx]]
                opp_idx = np.setdiff1d(idx, treino_idx)
                if treino_idx.size:
                    net = isr.net if eLado == "ISR" else egy.net
                    a, lp, v = acoes(net, obs[treino_idx], mask[treino_idx])
                    acts[treino_idx] = a
                    for k, i in enumerate(treino_idx):
                        traj[i].append((obs[i].copy(), mask[i].copy(), int(a[k]), float(lp[k])))
                if opp_idx.size:
                    net = op_isr if eLado == "ISR" else op_egy
                    a, _, _ = acoes(net, obs[opp_idx], mask[opp_idx], greedy=False)
                    acts[opp_idx] = a
            obs, mask, lado, rews, dones, fins = pool.step(acts)
            for f in fins:
                i = f["i"]
                ld = "ISR" if treina_isr[i] else "EGY"
                R = f["reward"] if ld == "ISR" else -f["reward"]   # reward é perspectiva ISR
                for (o, m, a, lp) in traj[i]:
                    coleta[ld].append((o, m, a, lp, R))
                traj[i] = []

        linha = {"update": up, "dec_por_s": round(args.passos * N / (time.time() - t0)),
                 "isr_eps": len(coleta["ISR"]), "egy_eps": len(coleta["EGY"])}
        for ld, ag in (("ISR", isr), ("EGY", egy)):
            dados = coleta[ld]
            if dados:
                o = np.stack([d[0] for d in dados]); m = np.stack([d[1] for d in dados])
                a = np.array([d[2] for d in dados]); lp = np.array([d[3] for d in dados], dtype=np.float32)
                R = np.array([d[4] for d in dados], dtype=np.float32)
                metr = ppo_update(ag, o, m, a, lp, R, args)
            else:
                metr = {"perda_v": 0.0, "entropia": 0.0, "n": 0}
            for k, v in metr.items():
                linha[f"{ld.lower()}_{k}"] = v

        if up % args.congela_cada == 0:
            isr.congela(); egy.congela()

        if up % args.medir_cada == 0 or up == args.updates:
            cruz = confronto(isr.net, egy.net, "both", args, 800000 + up)
            h_i = confronto(isr.net, None, "ISR", args, 810000 + up)
            h_e = confronto(None, egy.net, "EGY", args, 820000 + up)
            linha.update({
                "isr_win_vs_egy": winrate(cruz, "ISR"), "egy_win_vs_isr": winrate(cruz, "EGY"),
                "isr_win_vs_heur": winrate(h_i, "ISR"), "egy_win_vs_heur": winrate(h_e, "EGY")})
            exporta_spec(isr.net, os.path.join(pasta, "ISR.json"))
            exporta_spec(egy.net, os.path.join(pasta, "EGY.json"))
            torch.save({"modelo": isr.net.state_dict(), "arch": isr.arch, "update": up},
                       os.path.join(pasta, f"ckpt_isr_{up:04d}.pt"))
            torch.save({"modelo": egy.net.state_dict(), "arch": egy.arch, "update": up},
                       os.path.join(pasta, f"ckpt_egy_{up:04d}.pt"))

        open(mpath, "a").write(json.dumps(linha) + "\n")
        gera_dashboard(pasta, run, args)
        print(f"  up {up:4d} | ISRvsEGY {linha.get('isr_win_vs_egy','—')} | "
              f"ISRvsHeur {linha.get('isr_win_vs_heur','—')} EGYvsHeur {linha.get('egy_win_vs_heur','—')} | "
              f"ent I{linha['isr_entropia']:.2f}/E{linha['egy_entropia']:.2f} | {linha['dec_por_s']} dec/s")

    pool.fecha()
    print(f"fim. dashboard: {os.path.join(pasta, 'dashboard.html')}")


def gera_dashboard(pasta, run, args):
    linhas = [json.loads(l) for l in open(os.path.join(pasta, "metrics.jsonl"))
              if l.strip()] if os.path.exists(os.path.join(pasta, "metrics.jsonl")) else []
    html = DASH.replace("__DADOS__", json.dumps(linhas)) \
               .replace("__RUN__", f"{run}: ISR={args.arch_isr} × EGY={args.arch_egy}")
    open(os.path.join(pasta, "dashboard.html"), "w").write(html)


DASH = """<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="15"><title>Self-play — __RUN__</title>
<style>body{font-family:Georgia,serif;background:#efe7d2;color:#2b2418;margin:20px}
h1{border-bottom:3px double #2b2418;padding-bottom:6px}
.grade{display:grid;grid-template-columns:1fr 1fr;gap:18px;max-width:1200px}
.cartao{background:#fff;border:2px solid #2b2418;padding:10px}
.cartao h3{margin:0 0 6px;font-size:14px;text-transform:uppercase}canvas{width:100%;height:220px}
.nota{font-size:13px;color:#555}</style></head><body>
<h1>Self-play — __RUN__</h1>
<p class="nota">Fase B: as duas redes co-evoluem. Atualiza a cada 15 s.</p>
<div class="grade">
<div class="cartao"><h3>Confronto direto: vitória ISR × EGY</h3><canvas id="c_cruz"></canvas></div>
<div class="cartao"><h3>Cada lado vs heurística (Fase A)</h3><canvas id="c_heur"></canvas></div>
<div class="cartao"><h3>Entropia das políticas</h3><canvas id="c_ent"></canvas></div>
<div class="cartao"><h3>Perda de valor</h3><canvas id="c_v"></canvas></div>
</div>
<script>const D=__DADOS__;
function plota(id,series,cores,rot,ymin,ymax){const cv=document.getElementById(id);
cv.width=cv.clientWidth*2;cv.height=cv.clientHeight*2;const ctx=cv.getContext('2d');ctx.scale(2,2);
const W=cv.clientWidth,H=cv.clientHeight,m=28;const xs=D.map(d=>d.update);
if(!xs.length){ctx.fillText('aguardando…',20,30);return;}
const x0=Math.min(...xs),x1=Math.max(...xs,x0+1);let lo=ymin,hi=ymax;
if(lo===undefined){lo=Infinity;hi=-Infinity;for(const s of series)for(const v of s)if(v!=null){lo=Math.min(lo,v);hi=Math.max(hi,v);}if(!isFinite(lo)){lo=0;hi=1;}if(hi-lo<1e-6)hi=lo+1;}
const X=v=>m+(v-x0)/(x1-x0)*(W-2*m),Y=v=>H-m-(v-lo)/(hi-lo)*(H-2*m);
ctx.strokeStyle='#ccc';ctx.beginPath();ctx.moveTo(m,Y(lo));ctx.lineTo(W-m,Y(lo));ctx.moveTo(m,Y(lo));ctx.lineTo(m,Y(hi));ctx.stroke();
ctx.fillStyle='#555';ctx.font='10px Georgia';ctx.fillText(lo.toFixed(2),2,Y(lo));ctx.fillText(hi.toFixed(2),2,Y(hi)+8);
ctx.fillText('update '+x0,m,H-6);ctx.fillText(''+x1,W-m-20,H-6);
series.forEach((s,si)=>{ctx.strokeStyle=cores[si];ctx.lineWidth=1.6;ctx.beginPath();let st=false;
s.forEach((v,i)=>{if(v==null)return;if(!st){ctx.moveTo(X(xs[i]),Y(v));st=true;}else ctx.lineTo(X(xs[i]),Y(v));});ctx.stroke();
if(rot){ctx.fillStyle=cores[si];ctx.fillText(rot[si],W-m-90,14+si*12);}});}
plota('c_cruz',[D.map(d=>d.isr_win_vs_egy),D.map(d=>d.egy_win_vs_isr)],['#1565c0','#b71c1c'],['ISR','EGY'],0,1);
plota('c_heur',[D.map(d=>d.isr_win_vs_heur),D.map(d=>d.egy_win_vs_heur)],['#1565c0','#b71c1c'],['ISR','EGY'],0,1);
plota('c_ent',[D.map(d=>d.isr_entropia),D.map(d=>d.egy_entropia)],['#1565c0','#b71c1c'],['ISR','EGY']);
plota('c_v',[D.map(d=>d.isr_perda_v),D.map(d=>d.egy_perda_v)],['#1565c0','#b71c1c'],['ISR','EGY']);
</script></body></html>"""


if __name__ == "__main__":
    main()
