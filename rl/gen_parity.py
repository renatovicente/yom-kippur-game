"""Gera os casos de paridade Python<->JS (rl/_parity_cases.json) para as 3
arquiteturas, incluindo a saida da cabeca de VALOR (critico). Reproduzivel.
Uso: python3 rl/gen_parity.py
A mascara e toda-1 (no-op no masked_fill) para que os logits exportados sejam
os crus -- exatamente o que o interpretador em JS calcula."""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import torch
from nets import cria, OBS_TAM, N_ACOES

torch.manual_seed(0)
casos = []
for arch in ["mlp", "cnn", "gnn"]:
    net = cria(arch).train(False)        # modo inferencia (sem dropout/bn updates)
    obs = torch.randn(1, OBS_TAM)
    mask = torch.ones(1, N_ACOES)
    with torch.no_grad():
        logits, valor = net(obs, mask)
    casos.append({
        "arch": arch,
        "spec": net.export_spec(),
        "obs": obs[0].tolist(),
        "logits": logits[0].tolist(),
        "valor": float(valor[0]),
    })

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_parity_cases.json")
json.dump(casos, open(out, "w"))
print(f"gravado {out} com {len(casos)} casos (logits + valor)")
