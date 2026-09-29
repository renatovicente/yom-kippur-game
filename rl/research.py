#!/usr/bin/env python3
"""Linha de PESQUISA — self-play estabilizado para o lado fraco (atacante israelense).

NÃO substitui a versão de produção (modelos da Fase A continuam intactos). Explora
três técnicas, ativáveis isoladamente ou combinadas, para evitar a degradação do
ISR observada no self-play ingênuo (rl/selfplay.py):

  1. SHAPING baseado em potencial (--shaping COEF): credita progresso do atacante
     (ponte, SAMs, objetivos, cabeça-de-ponte) via Φ vindo do worker. Com gamma=1 o
     retorno telescopa: retorno_t = R_terminal + COEF·(Φ_final − Φ_t), preservando
     a política ótima (Ng et al. 1999) e densificando o sinal de aprendizado.

  2. SELF-PLAY ASSIMÉTRICO: mais updates/ambientes no lado fraco
     (--epocas-isr > --epocas-egy, --lr-isr, --lr-egy, --frac-isr).

  3. FICTITIOUS PLAY + KL-PENALTY (--kl-coef, --ancora-isr CKPT): oponente amostrado
     da liga histórica (fictitious play) + penalidade KL(π_atual‖π_âncora) que prende
     a política ao conhecimento da Fase A, evitando esquecimento catastrófico.

Uso (exemplo combinando as três):
  python3 rl/research.py --run exp1 \
      --arch-isr mlp --arch-egy gnn \
      --seed-isr rl/runs/ISR_v2/ckpt_0150.pt --seed-egy rl/runs/EGY_gnn/ckpt_0150.pt \
      --ancora-isr rl/runs/ISR_v2/ckpt_0150.pt \
      --shaping 0.1 --kl-coef 0.05 --lr-isr 1e-4 --lr-egy 5e-5 \
      --epocas-isr 6 --epocas-egy 2 --frac-isr 0.66 --updates 200
"""
import argparse, copy, json, os, random, time

import numpy as np
import torch
import torch.nn as nn

import sys as _sys
_sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import rl.nets as nets
from rl.train import PoolWorkers
from rl.selfplay import carrega_state, exporta_spec, acoes, confronto, winrate

RAIZ = os.path.dirname(os.path.abspath(__file__))


# workers que também decodificam o potencial Φ do atacante (campo aditivo)
class PoolPhi(PoolWorkers):
    def _decodifica(self, lotes):
        import base64
        obs = np.concatenate([np.frombuffer(base64.b64decode(l["obs"]), dtype=np.float32)
                              .reshape(self.envs, self.obs_tam) for l in lotes])
        mask = np.concatenate([np.frombuffer(base64.b64decode(l["mask"]), dtype=np.uint8)
                               .reshape(self.envs, self.n_acoes) for l in lotes])
        lado = np.concatenate([np.array(l["lado"], dtype=np.int64) for l in lotes])
        rews = np.concatenate([np.array(l["rews"], dtype=np.float32) for l in lotes])
        dones = np.concatenate([np.array(l["dones"], dtype=np.float32) for l in lotes])
        phi = np.concatenate([np.array(l["phi"], dtype=np.float32) for l in lotes])
        fins = [f for l in lotes for f in l["fins"]]
        return obs, mask, lado, rews, dones, phi, fins


class Agente:
    def __init__(self, arch, lr, epocas, semente=None, ancora=None):
        self.arch, self.lr, self.epocas = arch, lr, epocas
        self.net = nets.cria(arch)
        if semente and os.path.exists(semente) and carrega_state(self.net, semente):
            print(f"  {arch}: semeado de {os.path.basename(semente)}")
        self.otim = torch.optim.Adam(self.net.parameters(), lr=lr)
        self.liga = []
        self.ancora = None
        if ancora and os.path.exists(ancora):
            self.ancora = nets.cria(arch)
            if carrega_state(self.ancora, ancora):
                print(f"  {arch}: âncora KL de {os.path.basename(ancora)}")
            else:
                self.ancora = None

    def congela(self):
        self.liga.append(copy.deepcopy(self.net.state_dict()))
        if len(self.liga) > 10:
            self.liga.pop(0)

    def oponente(self):  # fictitious play: amostra a liga histórica
        net = nets.cria(self.arch)
        if self.liga and random.random() > 0.2:
            net.load_state_dict(random.choice(self.liga))
        else:
            net.load_state_dict(self.net.state_dict())
        return net


def ppo_update(ag, obs, mask, act, logp_old, ret, args, kl_coef):
    if len(ret) == 0:
        return {"perda_v": 0.0, "entropia": 0.0, "kl": 0.0, "n": 0}
    to = torch.from_numpy
    d_obs, d_mask = to(obs), to(mask.astype(np.float32))
    d_act, d_logp = to(act).long(), to(logp_old)
    d_ret = to(ret)
    with torch.no_grad():
        _, v0 = ag.net(d_obs, d_mask)
        # logits da âncora p/ KL (fixos durante o update)
        anc_logits = None
        if ag.ancora is not None and kl_coef > 0:
            anc_logits, _ = ag.ancora(d_obs, d_mask)
    adv = d_ret - v0
    adv = (adv - adv.mean()) / (adv.std() + 1e-8)
    n = len(ret); idx = np.arange(n)
    pv, en, kls = [], [], []
    for _ in range(ag.epocas):
        np.random.shuffle(idx)
        for i0 in range(0, n, args.minibatch):
            mb = to(idx[i0:i0 + args.minibatch]).long()
            logits, v = ag.net(d_obs[mb], d_mask[mb])
            dist = torch.distributions.Categorical(logits=logits)
            lp = dist.log_prob(d_act[mb])
            r = torch.exp(lp - d_logp[mb]); a = adv[mb]
            l_pi = -torch.min(r * a, r.clamp(1 - args.clip, 1 + args.clip) * a).mean()
            l_v = ((v - d_ret[mb]) ** 2).mean()
            ent = dist.entropy().mean()
            perda = l_pi + 0.5 * l_v - args.entropia * ent
            kl_val = 0.0
            if anc_logits is not None:
                anc = torch.distributions.Categorical(logits=anc_logits[mb])
                kl = torch.distributions.kl_divergence(dist, anc).mean()  # KL(atual‖âncora)
                perda = perda + kl_coef * kl
                kl_val = kl.item()
            ag.otim.zero_grad()
            perda.backward()
            nn.utils.clip_grad_norm_(ag.net.parameters(), 0.5)
            ag.otim.step()
            pv.append(l_v.item()); en.append(ent.item()); kls.append(kl_val)
    return {"perda_v": float(np.mean(pv)), "entropia": float(np.mean(en)),
            "kl": float(np.mean(kls)), "n": n}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default=None)
    ap.add_argument("--arch-isr", default="mlp", choices=list(nets.ARCHS))
    ap.add_argument("--arch-egy", default="gnn", choices=list(nets.ARCHS))
    ap.add_argument("--seed-isr", default=None)
    ap.add_argument("--seed-egy", default=None)
    ap.add_argument("--ancora-isr", default=None, help="ckpt p/ KL-penalty do ISR")
    ap.add_argument("--ancora-egy", default=None)
    ap.add_argument("--shaping", type=float, default=0.0, help="coef do reward shaping do atacante")
    ap.add_argument("--kl-coef", type=float, default=0.0)
    ap.add_argument("--lr-isr", type=float, default=1e-4)
    ap.add_argument("--lr-egy", type=float, default=5e-5)
    ap.add_argument("--epocas-isr", type=int, default=6)
    ap.add_argument("--epocas-egy", type=int, default=2)
    ap.add_argument("--frac-isr", type=float, default=0.6, help="fração de ambientes treinando ISR")
    ap.add_argument("--updates", type=int, default=200)
    ap.add_argument("--procs", type=int, default=8)
    ap.add_argument("--envs", type=int, default=4)
    ap.add_argument("--passos", type=int, default=256)
    ap.add_argument("--clip", type=float, default=0.2)
    ap.add_argument("--entropia", type=float, default=0.02)
    ap.add_argument("--minibatch", type=int, default=1024)
    ap.add_argument("--congela_cada", type=int, default=10)
    ap.add_argument("--medir_cada", type=int, default=5)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    torch.manual_seed(args.seed); np.random.seed(args.seed); random.seed(args.seed)
    run = args.run or f"RES_{time.strftime('%H%M%S')}"
    pasta = os.path.join(RAIZ, "runs", run); os.makedirs(pasta, exist_ok=True)
    mpath = os.path.join(pasta, "metrics.jsonl")
    json.dump(vars(args), open(os.path.join(pasta, "config.json"), "w"), indent=2)

    isr = Agente(args.arch_isr, args.lr_isr, args.epocas_isr, args.seed_isr, args.ancora_isr)
    egy = Agente(args.arch_egy, args.lr_egy, args.epocas_egy, args.seed_egy, args.ancora_egy)

    pool = PoolPhi(args.procs, args.envs, "both", seed0=1 + args.seed)
    N = pool.n
    corte = max(1, int(round(N * args.frac_isr)))     # ambientes 0..corte treinam ISR
    treina_isr = np.array([i < corte for i in range(N)])
    print(f"pesquisa {run}: ISR={args.arch_isr}(lr{args.lr_isr},ep{args.epocas_isr}) × "
          f"EGY={args.arch_egy}(lr{args.lr_egy},ep{args.epocas_egy}) | shaping={args.shaping} "
          f"kl={args.kl_coef} | {corte}/{N} ambientes treinam ISR")

    obs, mask, lado, _, _, phi, _ = pool.reset()
    phi_atual = phi.copy()                  # Φ(s) corrente por ambiente

    for up in range(1, args.updates + 1):
        t0 = time.time()
        op_egy, op_isr = egy.oponente(), isr.oponente()
        traj = [[] for _ in range(N)]       # (obs,mask,act,logp,phi_t) do lado-em-treino
        coleta = {"ISR": [], "EGY": []}     # (obs,mask,act,logp,retorno)

        for t in range(args.passos):
            acts = np.zeros(N, dtype=np.int64)
            for code, eLado in ((0, "ISR"), (1, "EGY")):
                idx = np.where(lado == code)[0]
                if not idx.size:
                    continue
                treino_idx = idx[treina_isr[idx]] if eLado == "ISR" else idx[~treina_isr[idx]]
                opp_idx = np.setdiff1d(idx, treino_idx)
                if treino_idx.size:
                    net = isr.net if eLado == "ISR" else egy.net
                    a, lp, _ = acoes(net, obs[treino_idx], mask[treino_idx])
                    acts[treino_idx] = a
                    for k, i in enumerate(treino_idx):
                        traj[i].append((obs[i].copy(), mask[i].copy(), int(a[k]),
                                        float(lp[k]), float(phi_atual[i])))
                if opp_idx.size:
                    net = op_isr if eLado == "ISR" else op_egy
                    a, _, _ = acoes(net, obs[opp_idx], mask[opp_idx])
                    acts[opp_idx] = a
            obs, mask, lado, rews, dones, phi, fins = pool.step(acts)
            phi_atual = phi.copy()
            for f in fins:
                i = f["i"]; ld = "ISR" if treina_isr[i] else "EGY"
                R = f["reward"] if ld == "ISR" else -f["reward"]
                phi_final = float(phi[i])    # Φ no estado terminal (pré-reset, do worker)
                for (o, m, a, lp, phit) in traj[i]:
                    # shaping só para o atacante (ISR): R + coef·(Φ_final − Φ_t)
                    shap = args.shaping * (phi_final - phit) if ld == "ISR" else 0.0
                    coleta[ld].append((o, m, a, lp, R + shap))
                traj[i] = []

        linha = {"update": up, "dec_por_s": round(args.passos * N / (time.time() - t0))}
        for ld, ag in (("ISR", isr), ("EGY", egy)):
            dados = coleta[ld]
            if dados:
                o = np.stack([d[0] for d in dados]); m = np.stack([d[1] for d in dados])
                a = np.array([d[2] for d in dados]); lp = np.array([d[3] for d in dados], dtype=np.float32)
                R = np.array([d[4] for d in dados], dtype=np.float32)
                kl = args.kl_coef if ld == "ISR" else (args.kl_coef if ag.ancora else 0.0)
                metr = ppo_update(ag, o, m, a, lp, R, args, kl)
            else:
                metr = {"perda_v": 0.0, "entropia": 0.0, "kl": 0.0, "n": 0}
            for k, v in metr.items():
                linha[f"{ld.lower()}_{k}"] = v

        if up % args.congela_cada == 0:
            isr.congela(); egy.congela()

        if up % args.medir_cada == 0 or up == args.updates:
            cruz = confronto(isr.net, egy.net, "both", args, 700000 + up)
            h_i = confronto(isr.net, None, "ISR", args, 710000 + up)
            h_e = confronto(None, egy.net, "EGY", args, 720000 + up)
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
              f"ent I{linha['isr_entropia']:.2f} kl {linha.get('isr_kl',0):.3f} | {linha['dec_por_s']} dec/s")

    pool.fecha()
    print(f"fim. dashboard: {os.path.join(pasta, 'dashboard.html')}")


def gera_dashboard(pasta, run, args):
    mp = os.path.join(pasta, "metrics.jsonl")
    linhas = [json.loads(l) for l in open(mp) if l.strip()] if os.path.exists(mp) else []
    titulo = (f"{run}: ISR={args.arch_isr} × EGY={args.arch_egy} | "
              f"shaping={args.shaping} kl={args.kl_coef} assimétrico")
    open(os.path.join(pasta, "dashboard.html"), "w").write(
        DASH.replace("__DADOS__", json.dumps(linhas)).replace("__RUN__", titulo))


DASH = """<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="15"><title>Pesquisa — __RUN__</title>
<style>body{font-family:Georgia,serif;background:#efe7d2;color:#2b2418;margin:20px}
h1{border-bottom:3px double #2b2418;padding-bottom:6px;font-size:20px}
.grade{display:grid;grid-template-columns:1fr 1fr;gap:18px;max-width:1200px}
.cartao{background:#fff;border:2px solid #2b2418;padding:10px}
.cartao h3{margin:0 0 6px;font-size:14px;text-transform:uppercase}canvas{width:100%;height:220px}
.nota{font-size:13px;color:#555}</style></head><body>
<h1>Linha de pesquisa — __RUN__</h1>
<p class="nota">Objetivo: evitar a degradação do atacante (ISR) no self-play.
ISRvsHeur deve <b>não cair</b> de ~1.0; ISRvsEGY deve subir do ~0.</p>
<div class="grade">
<div class="cartao"><h3>Confronto direto ISR × EGY</h3><canvas id="c_cruz"></canvas></div>
<div class="cartao"><h3>Cada lado vs heurística (Fase A)</h3><canvas id="c_heur"></canvas></div>
<div class="cartao"><h3>Entropia das políticas</h3><canvas id="c_ent"></canvas></div>
<div class="cartao"><h3>KL(atual‖âncora) do ISR</h3><canvas id="c_kl"></canvas></div>
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
plota('c_kl',[D.map(d=>d.isr_kl)],['#6a1b9a']);
</script></body></html>"""


if __name__ == "__main__":
    main()
