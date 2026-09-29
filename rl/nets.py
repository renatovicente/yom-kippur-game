"""Arquiteturas de política/valor para A Guerra do Yom Kippur.

Três opções com a MESMA interface — forward(obs, mask) -> (logits[.,539], valor[.]):
  - MLP : densa sobre o vetor de observação (rápida, leve; a da Fase A)
  - CNN : convoluções sobre a grade 22×25 (entende vizinhança espacial)
  - GNN : message-passing sobre o grafo hexagonal real (topologia exata)

Cada rede também sabe se EXPORTAR como uma lista de camadas executáveis
(`export_spec`) que o interpretador em JS (web/js/ai-neural.js) roda no navegador —
um único motor de inferência serve as três arquiteturas, sem dependências externas.
O teste rl/test-parity.mjs confere que o forward JS bate com o PyTorch.
"""
import base64, json, os
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

RAIZ = os.path.dirname(os.path.abspath(__file__))
_LAY = json.load(open(os.path.join(RAIZ, "layout.json")))
COLS, ROWS, NHEX = _LAY["COLS"], _LAY["ROWS"], _LAY["n"]
GRID = _LAY["grid"]                       # [casa] -> [col, row]
ADJ = _LAY["adj"]                         # [[i,j], ...]
N_PLANOS = 20
N_GLOBAL = 16
OBS_TAM = NHEX * N_PLANOS + N_GLOBAL      # 10776
N_ACOES = NHEX + 1                        # 539

# índice linear na grade ROWS×COLS de cada casa (para scatter espacial)
_cell = torch.tensor([r * COLS + c for (c, r) in GRID], dtype=torch.long)
# matriz de adjacência normalizada por linha (média dos vizinhos), densa NHEX×NHEX
_A = np.zeros((NHEX, NHEX), dtype=np.float32)
for i, j in ADJ:
    _A[i, j] = 1.0; _A[j, i] = 1.0
_A /= np.maximum(_A.sum(1, keepdims=True), 1.0)
_An = torch.from_numpy(_A)


def b64(t):
    return base64.b64encode(t.detach().cpu().numpy().astype(np.float32).tobytes()).decode()


# ----------------------------------------------------------------- helpers
def _split(obs):
    """obs[B,OBS_TAM] -> planos[B,NPLANOS,NHEX], globais[B,N_GLOBAL]"""
    planos = obs[:, :N_PLANOS * NHEX].reshape(-1, N_PLANOS, NHEX)
    glob = obs[:, N_PLANOS * NHEX:]
    return planos, glob


def _to_grid(planos):
    """planos[B,C,NHEX] -> grade[B,C,ROWS*COLS] (casas espalhadas, resto 0)"""
    B, C, _ = planos.shape
    g = planos.new_zeros(B, C, ROWS * COLS)
    g[:, :, _cell] = planos
    return g.reshape(B, C, ROWS, COLS)


# ----------------------------------------------------------------- MLP
class MLP(nn.Module):
    arch = "mlp"

    def __init__(self, h1=256, h2=128):
        super().__init__()
        self.l1 = nn.Linear(OBS_TAM, h1)
        self.l2 = nn.Linear(h1, h2)
        self.pi = nn.Linear(h2, N_ACOES)
        self.v = nn.Linear(h2, 1)
        nn.init.orthogonal_(self.pi.weight, 0.01)
        nn.init.orthogonal_(self.v.weight, 1.0)

    def forward(self, obs, mask):
        z = torch.tanh(self.l1(obs))
        z = torch.tanh(self.l2(z))
        logits = self.pi(z).masked_fill(mask < 0.5, -1e9)
        return logits, self.v(z).squeeze(-1)

    def export_spec(self):
        return {"arch": "mlp", "obs": OBS_TAM, "acoes": N_ACOES, "layers": [
            {"op": "linear", "W": b64(self.l1.weight), "b": b64(self.l1.bias),
             "nin": OBS_TAM, "nout": self.l1.out_features, "act": "tanh"},
            {"op": "linear", "W": b64(self.l2.weight), "b": b64(self.l2.bias),
             "nin": self.l1.out_features, "nout": self.l2.out_features, "act": "tanh"},
            {"op": "heads", "Wpi": b64(self.pi.weight), "bpi": b64(self.pi.bias),
             "Wv": b64(self.v.weight), "bv": b64(self.v.bias),
             "nin": self.l2.out_features, "nacoes": N_ACOES}]}


# ----------------------------------------------------------------- CNN
class CNN(nn.Module):
    arch = "cnn"

    def __init__(self, c=32):
        super().__init__()
        self.c1 = nn.Conv2d(N_PLANOS, c, 3, padding=1)
        self.c2 = nn.Conv2d(c, c, 3, padding=1)
        self.pi_hex = nn.Conv2d(c, 1, 1)               # 1 logit por casa
        self.g = nn.Linear(c + N_GLOBAL, 64)
        self.pi_pass = nn.Linear(64, 1)                # logit de PASSAR
        self.v = nn.Linear(64, 1)
        nn.init.orthogonal_(self.pi_hex.weight, 0.01)
        nn.init.orthogonal_(self.pi_pass.weight, 0.01)
        nn.init.orthogonal_(self.v.weight, 1.0)

    def _tronco(self, obs):
        planos, glob = _split(obs)
        x = F.relu(self.c1(_to_grid(planos)))
        x = F.relu(self.c2(x))                         # [B,c,ROWS,COLS]
        hexlog = self.pi_hex(x).reshape(x.shape[0], -1)[:, _cell]   # [B,NHEX]
        pool = x.mean(dim=(2, 3))                      # [B,c]
        h = torch.tanh(self.g(torch.cat([pool, glob], dim=1)))
        return hexlog, h

    def forward(self, obs, mask):
        hexlog, h = self._tronco(obs)
        logits = torch.cat([hexlog, self.pi_pass(h)], dim=1).masked_fill(mask < 0.5, -1e9)
        return logits, self.v(h).squeeze(-1)

    def export_spec(self):
        return {"arch": "cnn", "obs": OBS_TAM, "acoes": N_ACOES,
                "cols": COLS, "rows": ROWS, "planos": N_PLANOS, "nglobal": N_GLOBAL,
                "layers": [
                    {"op": "conv", "W": b64(self.c1.weight), "b": b64(self.c1.bias),
                     "cin": N_PLANOS, "cout": self.c1.out_channels, "act": "relu"},
                    {"op": "conv", "W": b64(self.c2.weight), "b": b64(self.c2.bias),
                     "cin": self.c2.in_channels, "cout": self.c2.out_channels, "act": "relu"},
                    {"op": "cnn_heads",
                     "Whex": b64(self.pi_hex.weight), "bhex": b64(self.pi_hex.bias),
                     "Wg": b64(self.g.weight), "bg": b64(self.g.bias),
                     "Wpass": b64(self.pi_pass.weight), "bpass": b64(self.pi_pass.bias),
                     "Wv": b64(self.v.weight), "bv": b64(self.v.bias),
                     "c": self.c2.out_channels, "g": self.g.out_features}]}


# ----------------------------------------------------------------- GNN
def _gnn_msg(x):
    """x[B,N,F] -> concat(x, média dos vizinhos)[B,N,2F]"""
    viz = torch.einsum("ij,bjf->bif", _An.to(x.device), x)
    return torch.cat([x, viz], dim=-1)


class GNN(nn.Module):
    arch = "gnn"

    def __init__(self, f=32):
        super().__init__()
        self.g1 = nn.Linear(2 * N_PLANOS, f)
        self.g2 = nn.Linear(2 * f, f)
        self.pi_hex = nn.Linear(f, 1)
        self.g = nn.Linear(f + N_GLOBAL, 64)
        self.pi_pass = nn.Linear(64, 1)
        self.v = nn.Linear(64, 1)
        nn.init.orthogonal_(self.pi_hex.weight, 0.01)
        nn.init.orthogonal_(self.pi_pass.weight, 0.01)
        nn.init.orthogonal_(self.v.weight, 1.0)

    def _tronco(self, obs):
        planos, glob = _split(obs)
        x = planos.transpose(1, 2)                     # [B,NHEX,planos]
        x = torch.tanh(self.g1(_gnn_msg(x)))
        x = torch.tanh(self.g2(_gnn_msg(x)))           # [B,NHEX,f]
        hexlog = self.pi_hex(x).squeeze(-1)            # [B,NHEX]
        pool = x.mean(dim=1)                           # [B,f]
        h = torch.tanh(self.g(torch.cat([pool, glob], dim=1)))
        return hexlog, h

    def forward(self, obs, mask):
        hexlog, h = self._tronco(obs)
        logits = torch.cat([hexlog, self.pi_pass(h)], dim=1).masked_fill(mask < 0.5, -1e9)
        return logits, self.v(h).squeeze(-1)

    def export_spec(self):
        return {"arch": "gnn", "obs": OBS_TAM, "acoes": N_ACOES,
                "planos": N_PLANOS, "nglobal": N_GLOBAL,
                "layers": [
                    {"op": "gnn", "W": b64(self.g1.weight), "b": b64(self.g1.bias),
                     "fin": N_PLANOS, "fout": self.g1.out_features, "act": "tanh"},
                    {"op": "gnn", "W": b64(self.g2.weight), "b": b64(self.g2.bias),
                     "fin": self.g1.out_features, "fout": self.g2.out_features, "act": "tanh"},
                    {"op": "gnn_heads",
                     "Whex": b64(self.pi_hex.weight), "bhex": b64(self.pi_hex.bias),
                     "Wg": b64(self.g.weight), "bg": b64(self.g.bias),
                     "Wpass": b64(self.pi_pass.weight), "bpass": b64(self.pi_pass.bias),
                     "Wv": b64(self.v.weight), "bv": b64(self.v.bias),
                     "f": self.g2.out_features, "g": self.g.out_features}]}


ARCHS = {"mlp": MLP, "cnn": CNN, "gnn": GNN}


def cria(arch, **kw):
    if arch not in ARCHS:
        raise ValueError(f"arquitetura desconhecida: {arch} (use {list(ARCHS)})")
    return ARCHS[arch](**kw)
