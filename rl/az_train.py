"""Treino supervisionado estilo AlphaZero sobre os registros de auto-jogo
(rl/az_selfplay.mjs): perda = entropia cruzada da politica contra pi (visitas da
busca) + EQM do valor contra z (desfecho graduado). Aquece a partir de um
checkpoint e re-exporta a spec (com cabeca de valor) para a proxima iteracao.

Uso: python3 rl/az_train.py --dados d.jsonl --lado ISR --arch mlp \
        --ckpt_in in.pt --ckpt_out out.pt --spec_out out.json --epocas 4
"""
import os, sys, json, base64, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import torch
import torch.nn.functional as F
from nets import cria, OBS_TAM, N_ACOES

ap = argparse.ArgumentParser()
ap.add_argument("--dados", required=True)
ap.add_argument("--lado", required=True, choices=["ISR", "EGY"])
ap.add_argument("--arch", default="mlp")
ap.add_argument("--ckpt_in", default="")
ap.add_argument("--ckpt_out", required=True)
ap.add_argument("--spec_out", required=True)
ap.add_argument("--epocas", type=int, default=4)
ap.add_argument("--lote", type=int, default=256)
ap.add_argument("--lr", type=float, default=3e-4)
# em PUCT o VALOR domina o prior: este modo congela a politica (preserva o prior
# forte do PPO) e re-treina SO a cabeca de valor nos desfechos reais do auto-jogo.
ap.add_argument("--so_valor", action="store_true")
args = ap.parse_args()

REMAP = {"tronco.0": "l1", "tronco.2": "l2", "cab_pi": "pi", "cab_v": "v"}


def carrega_pesos(net, ckpt):
    raw = torch.load(ckpt, map_location="cpu", weights_only=False)
    sd = raw["modelo"] if isinstance(raw, dict) and "modelo" in raw else raw
    sd2 = {}
    for k, v in sd.items():
        nk = k
        for a, b in REMAP.items():
            if k.startswith(a):
                nk = b + k[len(a):]
                break
        sd2[nk] = v
    net.load_state_dict(sd2)


def f32(b64):
    return np.frombuffer(base64.b64decode(b64), dtype=np.float32)


def u8(b64):
    return np.frombuffer(base64.b64decode(b64), dtype=np.uint8)


# --- carrega o dataset do lado ---
obs, masks, pis, zs = [], [], [], []
for linha in open(args.dados):
    linha = linha.strip()
    if not linha:
        continue
    r = json.loads(linha)
    if r["s"] != args.lado:
        continue
    obs.append(f32(r["obs"]))
    masks.append(u8(r["mask"]).astype(np.float32))
    pi = np.zeros(N_ACOES, dtype=np.float32)
    for a, p in r["pi"]:
        pi[a] = p
    s = pi.sum()
    if s > 0:
        pi /= s
    pis.append(pi)
    zs.append(r["z"])

if not obs:
    print(f"sem registros para {args.lado} em {args.dados}; nada a treinar")
    sys.exit(0)

X = torch.tensor(np.stack(obs))
M = torch.tensor(np.stack(masks))
P = torch.tensor(np.stack(pis))
Z = torch.tensor(np.array(zs, dtype=np.float32))
n = X.shape[0]
print(f"{args.lado}: {n} registros | arch={args.arch}")

net = cria(args.arch)
if args.ckpt_in and os.path.exists(args.ckpt_in):
    carrega_pesos(net, args.ckpt_in)
    print(f"  aquecido de {args.ckpt_in}")

if args.so_valor:
    # congela tudo menos a cabeca de valor; otimiza so v.* (prior intacto)
    treinaveis = []
    for nome, p in net.named_parameters():
        p.requires_grad = nome.startswith("v.")
        if p.requires_grad:
            treinaveis.append(p)
    print(f"  SO-VALOR: treinando {sum(p.numel() for p in treinaveis)} params da cabeca de valor")
    opt = torch.optim.Adam(treinaveis, lr=args.lr, weight_decay=1e-4)
else:
    opt = torch.optim.Adam(net.parameters(), lr=args.lr, weight_decay=1e-4)

for ep in range(args.epocas):
    perm = torch.randperm(n)
    tot_pi = tot_v = 0.0
    for i in range(0, n, args.lote):
        idx = perm[i:i + args.lote]
        logits, val = net(X[idx], M[idx])
        loss_v = F.mse_loss(val, Z[idx])
        if args.so_valor:
            loss = loss_v
        else:
            logp = F.log_softmax(logits, dim=1).clamp(min=-30)
            loss_pi = -(P[idx] * logp).sum(1).mean()
            loss = loss_pi + loss_v
            tot_pi += loss_pi.item() * len(idx)
        opt.zero_grad(); loss.backward(); opt.step()
        tot_v += loss_v.item() * len(idx)
    print(f"  época {ep+1}/{args.epocas}: perda_pi={tot_pi/n:.4f} perda_v={tot_v/n:.4f}")

torch.save({"modelo": net.state_dict(), "arch": args.arch}, args.ckpt_out)
json.dump(net.export_spec(), open(args.spec_out, "w"))
print(f"  salvo {args.ckpt_out} + spec {args.spec_out}")
