"""Orquestrador AlphaZero (warm-start, duas redes assimetricas).
Cada iteracao: (1) auto-jogo com as specs atuais -> dados; (2) treina ISR e EGY
nos dados; (3) re-exporta specs; (4) avalia PUCT vs heuristica (gating). Itera.

Aquece da iteracao 0 com os melhores modelos existentes. Numeros pequenos por
padrao para rodar numa maquina; suba --jogos/--sims/--iters para escalar.

Uso: python3 rl/az.py --iters 4 --jogos 24 --sims_sp 16 --sims_eval 48
"""
import os, sys, json, time, argparse, subprocess
RAIZ = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(RAIZ)


def node(args):
    return subprocess.run(["node"] + args, cwd=PROJ, capture_output=True, text=True)


def py(args):
    return subprocess.run([sys.executable] + args, cwd=PROJ, capture_output=True, text=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--iters", type=int, default=4)
    ap.add_argument("--jogos", type=int, default=24)       # partidas de auto-jogo/iter
    ap.add_argument("--sims_sp", type=int, default=16)     # simulacoes na busca (auto-jogo)
    ap.add_argument("--sims_eval", type=int, default=48)   # simulacoes na avaliacao
    ap.add_argument("--jogos_eval", type=int, default=10)
    ap.add_argument("--epocas", type=int, default=4)
    ap.add_argument("--dir", default=os.path.join(RAIZ, "runs", "AZ"))
    # iteracao 0 (aquecimento)
    ap.add_argument("--isr0_spec", default=os.path.join(PROJ, "web/models/ISR_selfplay.json"))
    ap.add_argument("--egy0_spec", default=os.path.join(PROJ, "web/models/EGY_gnn.json"))
    ap.add_argument("--isr0_ckpt", default=os.path.join(RAIZ, "runs/RES_v2/ckpt_isr_0250.pt"))
    ap.add_argument("--egy0_ckpt", default=os.path.join(RAIZ, "runs/EGY_gnn/ckpt_0150.pt"))
    args = ap.parse_args()

    os.makedirs(args.dir, exist_ok=True)
    log = open(os.path.join(args.dir, "historico.jsonl"), "a")

    isr_spec, egy_spec = args.isr0_spec, args.egy0_spec
    isr_ckpt, egy_ckpt = args.isr0_ckpt, args.egy0_ckpt

    # baseline (iteracao 0) antes de qualquer treino
    ev0 = node(["rl/az_eval.mjs", "--isr", isr_spec, "--egy", egy_spec,
                "--jogos", str(args.jogos_eval), "--sims", str(args.sims_eval)])
    base = json.loads(ev0.stdout.strip().splitlines()[-1]) if ev0.stdout.strip() else {}
    print(f"[iter 0 / baseline] PUCT vs heur: {base}")
    log.write(json.dumps({"iter": 0, "eval": base, "t": time.time()}) + "\n"); log.flush()

    for it in range(1, args.iters + 1):
        t0 = time.time()
        dados = os.path.join(args.dir, f"dados_{it:02d}.jsonl")
        # 1) auto-jogo
        sp = node(["rl/az_selfplay.mjs", "--isr", isr_spec, "--egy", egy_spec,
                   "--jogos", str(args.jogos), "--sims", str(args.sims_sp),
                   "--saida", dados, "--seed", str(70000 + it * 1000)])
        sys.stderr.write(sp.stderr)
        # 2+3) treina e re-exporta
        nisr_ckpt = os.path.join(args.dir, f"isr_{it:02d}.pt")
        nisr_spec = os.path.join(args.dir, f"isr_{it:02d}.json")
        negy_ckpt = os.path.join(args.dir, f"egy_{it:02d}.pt")
        negy_spec = os.path.join(args.dir, f"egy_{it:02d}.json")
        ri = py(["rl/az_train.py", "--dados", dados, "--lado", "ISR", "--arch", "mlp",
                 "--ckpt_in", isr_ckpt, "--ckpt_out", nisr_ckpt, "--spec_out", nisr_spec,
                 "--epocas", str(args.epocas)])
        re = py(["rl/az_train.py", "--dados", dados, "--lado", "EGY", "--arch", "gnn",
                 "--ckpt_in", egy_ckpt, "--ckpt_out", negy_ckpt, "--spec_out", negy_spec,
                 "--epocas", str(args.epocas)])
        for r in (ri, re):
            if r.returncode != 0:
                sys.stderr.write(r.stdout + "\n" + r.stderr + "\n")
        isr_ckpt, isr_spec = nisr_ckpt, nisr_spec
        egy_ckpt, egy_spec = negy_ckpt, negy_spec
        # 4) avaliacao
        ev = node(["rl/az_eval.mjs", "--isr", isr_spec, "--egy", egy_spec,
                   "--jogos", str(args.jogos_eval), "--sims", str(args.sims_eval)])
        res = json.loads(ev.stdout.strip().splitlines()[-1]) if ev.stdout.strip() else {}
        dt = time.time() - t0
        print(f"[iter {it}] PUCT vs heur: {res}  ({dt:.0f}s)")
        log.write(json.dumps({"iter": it, "eval": res, "t": time.time(), "dt": dt}) + "\n"); log.flush()

    print(f"\nbaseline: {base}")
    print(f"final   : {res}")
    print(f"specs finais: ISR={isr_spec}  EGY={egy_spec}")


if __name__ == "__main__":
    main()
