"""Re-exporta um checkpoint .pt como spec genatica (com cabeca de VALOR),
para a busca PUCT (web/js/ai-mcts.js) e a IA Neural usarem o MESMO modelo forte.
Lida com os dois esquemas de nomes de parametros ja salvos no projeto:
  - novo  (nets.py):  l1/l2/pi/v  (+ wrapper {'modelo','arch','update'})
  - antigo (Fase A):  tronco.0/tronco.2/cab_pi/cab_v
Uso: python3 rl/export_ckpt.py <ckpt.pt> <saida.json> [arch]
"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import torch
from nets import cria

ckpt = sys.argv[1]
saida = sys.argv[2]
arch = sys.argv[3] if len(sys.argv) > 3 else "mlp"

raw = torch.load(ckpt, map_location="cpu", weights_only=False)
arch = raw.get("arch", arch) if isinstance(raw, dict) and "arch" in raw else arch
sd = raw["modelo"] if isinstance(raw, dict) and "modelo" in raw else raw

# remapeia o esquema antigo (Fase A) para o de nets.py
mapa = {"tronco.0": "l1", "tronco.2": "l2", "cab_pi": "pi", "cab_v": "v"}
sd2 = {}
for k, v in sd.items():
    nk = k
    for a, b in mapa.items():
        if k.startswith(a):
            nk = b + k[len(a):]
            break
    sd2[nk] = v

net = cria(arch)
net.load_state_dict(sd2)
net.train(False)
json.dump(net.export_spec(), open(saida, "w"))
print(f"exportado {ckpt} ({arch}) -> {saida} (politica + valor)")
