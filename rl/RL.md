# Aprendizado de estratégia por Reinforcement Learning

Plano de implementação para treinar políticas de jogo por RL, com a fundação já
construída neste diretório:

- [`env.mjs`](env.mjs) — ambiente estilo *gym* sobre o motor real do jogo
  (`reset/step`, máscara de ações, observação tensorial, recompensa terminal);
- [`random-agent.mjs`](random-agent.mjs) — smoke test: política aleatória joga
  partidas completas dos dois lados (`node rl/random-agent.mjs 20`).

Medições do smoke test: **~4 episódios/s** num núcleo, **~90 decisões/episódio**,
observação de **10.776 floats**, **539 ações** discretas.

## 1. Formulação do MDP

| Elemento | Definição |
|---|---|
| **Episódio** | uma partida (6 rodadas, ~90 decisões da política por lado) |
| **Decisão** | uma microdecisão por `step`: destino de uma unidade, casa de entrada de reforço, ou alvo de barragem/cobertura |
| **Ação** | inteiro 0–538: índice de casa (0–537) ou `PASSAR` (538). A casa significa "mover para cá", "entrar por cá" ou "apoiar o combate cujo defensor está cá" |
| **Máscara** | vetor binário de 539 posições com as ações legais (vem do próprio motor: `alcance`, `casasEntrada`, `artilhariasDisponiveis`) — a política nunca explora jogadas ilegais |
| **Observação** | 20 planos de 538 casas (terreno one-hot, estrada, margem, objetivos, SAMs, e por lado: presença, IC, IM, baixas, artilharia pronta) + fase one-hot + 8 escalares (rodada, ponte, pools, perdas, lado) |
| **Recompensa** | terminal: decisiva ±1.0 · parcial ±0.6 · marginal ±0.3 · empate 0 |
| **Oponente** | IA heurística embutida (v1) ou política congelada (self-play) |

**Simplificação v1** (documentada no código): as escolhas da fase de resolução
(quem sofre baixas, casa de recuo, avanço) usam a heurística para ambos os lados.
São decisões de baixo impacto estratégico; a v2 pode expô-las como microdecisões
no mesmo espaço de ações.

## 2. Arquitetura da rede

A grade é pequena (25×22) — uma rede modesta basta:

- Reorganizar os planos em tensor `20×26×22` (colunas ímpares/pares já vêm
  alinhadas pela codificação axial implícita do índice);
- **Tronco**: 4–6 blocos convolucionais 3×3 com 64 filtros (ou uma GNN sobre o
  grafo de adjacência hexagonal, mais fiel à topologia);
- **Cabeça de política**: logits por casa (conv 1×1 → 538) + logit de PASSAR
  (do pooling global); aplicar a máscara somando −∞ aos ilegais antes do softmax;
- **Cabeça de valor**: pooling global → MLP → escalar em [−1, 1];
- Escalares/fase entram concatenados no pooling global (FiLM ou concat simples).

## 3. Algoritmo de treino

### Caminho recomendado: PPO com máscara + self-play em liga

1. **Fase A — vs heurística** (currículo): treinar ISR contra a IA heurística
   egípcia e vice-versa. Meta: >60% de vitória sobre a heurística dos dois lados.
   A heurística é um adversário razoável e *grátis* — já está no repositório.
2. **Fase B — self-play em liga**: pool de checkpoints; cada episódio sorteia o
   oponente entre os k últimos + heurística (evita o ciclo pedra-papel-tesoura).
   Como o jogo é assimétrico, manter **duas políticas** (ISR/EGY) ou uma única
   condicionada ao plano "lado" da observação (já incluído).
3. **Hiperparâmetros iniciais**: PPO clip 0.2, γ=1.0 (episódio curto, recompensa
   terminal), GAE λ=0.95, lr 3e-4, batch 4–8k decisões, entropia 0.01 com decay.

### Caminho de teto mais alto: AlphaZero-like

MCTS + rede, tratando os dados de combate como **nós de chance** — a CRT 2d6 tem
distribuição conhecida, então o valor esperado de cada combate pode ser calculado
exatamente (expectimax sobre 11 resultados × colunas). Requer `clone()` do estado
(trivial: o estado é um objeto plano — serializar unidades + contador do RNG).
Mais trabalho de engenharia; recomendado só depois do PPO dar linha de base.

## 4. Infraestrutura de treino

```
┌────────────┐   stdio JSON-lines   ┌──────────────────┐
│ Python     │ ◄──────────────────► │ Node: pool de    │
│ (PyTorch + │   obs/mask ↔ ação    │ workers env.mjs  │
│ PPO)       │                      │ (1 por núcleo)   │
└────────────┘                      └──────────────────┘
```

- **Ponte Node↔Python**: cada worker Node roda `env.mjs` e fala JSON-lines no
  stdin/stdout (`{"cmd":"reset","seed":1}` → `{"obs":[...],"mask":[...]}`).
  Um adaptador `gymnasium.Env` em Python vetoriza N workers. (~80 linhas de cada
  lado; alternativa: portar o motor para Python validando contra as mesmas
  sementes — só vale a pena se 4 ep/s × núcleos não bastar.)
- **Escala necessária**: modesta. Com 12 núcleos ≈ 50 ep/s ≈ 4M decisões/dia —
  suficiente para PPO neste tamanho de jogo. GPU única (ou Apple Silicon/MPS)
  para a rede. Na AWS: 1× g5.xlarge spot ou treino local.
- **Tracking**: W&B/TensorBoard; avaliação a cada N updates: 200 partidas vs
  heurística + vs checkpoint anterior, taxa de vitória ponderada por tipo
  (decisiva > parcial > marginal).

## 5. Integração de volta ao jogo

1. Exportar a política para **ONNX**;
2. Rodar no navegador com `onnxruntime-web` (WASM, ~2 MB de rede);
3. Novo nível de dificuldade no menu ("IA neural"), implementando o mesmo
   contrato de decisor da IA heurística — `ai.js` continua como nível padrão e
   fallback offline. O custo por decisão (~1 ms) é imperceptível.

## 6. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Espaço de ações mal decomposto trava o aprendizado | já mitigado: microdecisões com máscara legal vinda do motor (validado pelo smoke test) |
| Reward hacking com shaping | começar só com recompensa terminal; adicionar shaping (SAM, ponte, objetivos) apenas se o aprendizado estagnar, com pesos ≤0.05 |
| Sobreajuste ao oponente heurístico | liga de self-play (fase B) com heurística sempre no pool |
| Assimetria dos lados | duas políticas ou rede condicionada ao lado (plano já presente na observação) |
| Variância dos dados (2d6) | γ=1 + GAE; ou avaliar por pares de sementes espelhadas (mesma sequência de dados para ambos os lados) |

## 7. Roteiro

| Etapa | Entrega | Status |
|---|---|---|
| 1 | Ambiente `reset/step` + máscara + observação + smoke test | ✅ `env.mjs` (+ modo `both` p/ self-play) |
| 2 | Workers vetorizados + PPO (PyTorch) vs heurística | ✅ `worker.mjs` + `train.py` |
| 3 | Avaliação automatizada + dashboard de evolução | ✅ `train.py` (metrics.jsonl → dashboard.html) |
| 4 | Replay de checkpoints (inferência em JS puro) | ✅ `play-checkpoint.mjs` |
| 5 | **Fase A: treinar ISR e EGY vs heurística** | ✅ ambos > 95% de vitória (ver §9) |
| 6 | **"IA Neural" jogável no menu do jogo** | ✅ `rl-core.js` + `ai-neural.js` + modelos em `web/models/` |
| 7 | **Arquiteturas MLP / CNN / GNN** (treino + inferência no browser) | ✅ `nets.py` + interpretador genérico em `ai-neural.js` (paridade testada) |
| 8 | **Fase B: self-play em liga**, arquitetura independente por lado | ✅ `selfplay.py` |
| 9 | **Menu: escolha independente de controlador/modelo por lado** | ✅ `index.html` + `ui.js` + `web/models/manifest.json` |
| 10 | (opcional) MCTS/expectimax sobre a CRT | — |

## 10. Arquiteturas de rede (`nets.py`)

Três políticas com a mesma interface, escolhíveis por `--arch` (Fase A) ou
`--arch-isr/--arch-egy` (Fase B):

| Arquitetura | Tronco | Parâmetros | Modelo exportado | Ideia |
|---|---|---|---|---|
| **MLP** | duas densas sobre o vetor de 10.776 | 2,86 M | ~15 MB | a da Fase A; ignora a estrutura espacial |
| **CNN** | convoluções 3×3 sobre a grade 22×25 | ~18 mil | ~70 KB | aprende padrões de vizinhança local |
| **GNN** | message-passing sobre o grafo hexagonal real | ~6,7 mil | ~25 KB | respeita a topologia exata do tabuleiro |

CNN e GNN são **centenas de vezes menores** (compartilham pesos no espaço) — além
de potencialmente mais fortes, resolvem o peso de download dos modelos no navegador.

**Inferência no navegador (sem dependências):** o `policy.json` descreve a rede
como uma lista de camadas executáveis (`export_spec`); um interpretador genérico em
`web/js/ai-neural.js` roda qualquer das três. A correção é garantida por
`rl/test-parity.mjs`, que confere os 539 logits do forward JS contra o PyTorch
(erro < 1e-8 nas três arquiteturas).

## 11. Fase B — self-play em liga (`selfplay.py`)

Treina ISR e EGY **simultaneamente**, cada um com sua arquitetura, uma jogando
contra a outra. Estabilidade vem da **liga**: parte dos ambientes enfrenta versões
congeladas (checkpoints antigos) do oponente; o pool pode ser semeado com as
políticas da Fase A. Crédito de recompensa por trajetória (γ=1, recompensa
terminal). O dashboard mostra o confronto direto ISR×EGY e cada lado vs a
heurística da Fase A.

```bash
# self-play de arquiteturas distintas por lado
python3 rl/selfplay.py --arch-isr cnn --arch-egy gnn --updates 200

# self-play semeando com as políticas fortes da Fase A (parte de um equilíbrio)
python3 rl/selfplay.py --arch-isr mlp --arch-egy mlp \
    --seed-isr rl/runs/ISR_v2/ckpt_0150.pt --seed-egy rl/runs/EGY_v1/ckpt_0150.pt
```

Observação medida: as políticas da Fase A vencem ~100% da heurística, mas o
confronto direto entre elas fica ~equilibrado (ISR×EGY ≈ 0,5) — cada uma está
super-ajustada à heurística, não à outra. É exatamente o que o self-play corrige.

### Achado: adequação arquitetura ↔ lado (Fase A vs heurística)

| Lado | MLP (2,86 M) | CNN (18 k) | GNN (6,7 k) |
|---|---|---|---|
| **Egito** (defensivo, vizinhança local) | 100% | — | **92%** |
| **Israel** (planejamento de longo alcance) | **97%** | 0% | 0% |

> **Corrigido na revisita (§12e).** Estes números foram medidos contra a heurística
> **sem expectimax**, o padrão da época. Depois o expectimax foi ligado nos dois lados
> (§12b) e virou o oponente de todas as avaliações seguintes: contra ele o MLP da Fase A
> cai de 86,7% para **14,0%** (n=150). Re-treinado contra o defensor atual, volta a ~87%.

O lado israelense exige encadear ponte → travessia → objetivos espalhados; isso
demanda a **capacidade** do MLP. CNN e GNN (centenas de vezes menores) dão conta do
Egito reativo, mas no Israel colapsam num ótimo local de "perder por pouco" (a
entropia cai a 0 ~update 100 com a recompensa estagnada). Por isso o self-play de
referência usa **MLP no Israel e GNN no Egito** — o melhor de cada lado, e ainda
demonstra arquiteturas distintas por lado.

#### Investigação: por que CNN/GNN falham no atacante? **Capacidade, não viés indutivo.**

A hipótese intuitiva era *viés indutivo* (a equivariância translacional de CNN/GNN não
"aponta" a casa exata da ponte nem objetivos nomeados). Uma ablação controlada **refuta**
isso. O currículo é de recompensa esparsa; adicionamos o shaping baseado em potencial
(`train.py --shaping`, mesmo Φ de §12/`research.py`) ao atacante e variamos a largura
(`train.py --width`):

| GNN, currículo com shaping | params | win% vs heur. |
|---|---|---|
| Estreito, entropia 0,02 | 6,7 k | **0% (todas as avaliações)** |
| Largo, entropia 0,02 | 47,7 k | **pico 33%**, instável (oscila p/ 0–4%) |
| Largo, entropia 0,005 + lr menor | 47,7 k | **~15–21% sustentado** (entropia → 1,5) |

Achados: (i) **shaping sozinho não destrava rede pequena** — CNN/GNN nunca fazem
progresso parcial, então Φ≈0 e o termo de shaping é inerte (0%, igual ao sem shaping);
(ii) um **GNN 7× mais largo** sob as *mesmas* condições **aprende a vencer** (pico 33%,
à altura do MLP neste protocolo), enquanto o estreito com shaping idêntico fica em 0% →
**a alavanca é capacidade, não viés indutivo**; (iii) o largo é **instável** com entropia
padrão (pica e esquece, entropia ~3,4), mas **baixar a entropia (0,02→0,005) e o lr o faz
comprometer-se** (entropia →1,5) e **sustentar ~15–21%**. Logo a falha do atacante
compacto é de **capacidade + estabilidade de otimização**, não de representação.
Ferramentas: `nets.cria(arch, **kw)` aceita largura; `train.py --width/--shaping`.

## 12. Linha de pesquisa — self-play estabilizado (`research.py`)

O self-play ingênuo degrada o atacante (ISR cai a 0% — §11). Esta linha de
pesquisa **não toca a produção** (modelos da Fase A intactos) e combina três
técnicas, ativáveis isoladamente ou juntas:

1. **Shaping baseado em potencial** (`--shaping`): credita progresso do atacante
   (ponte, SAMs, objetivos, cabeça-de-ponte) via Φ vindo do worker (campo aditivo
   `env.potencialAtacante`). Com γ=1 o retorno telescopa para
   `R_terminal + coef·(Φ_final − Φ_t)` — densifica o sinal sem mudar o ótimo
   (Ng et al. 1999).
2. **Self-play assimétrico** (`--lr-isr/--lr-egy`, `--epocas-isr/--epocas-egy`,
   `--frac-isr`): mais updates/ambientes no lado fraco; o lado forte aprende devagar.
3. **Fictitious play + KL-penalty** (`--kl-coef`, `--ancora-isr`): oponente
   amostrado da liga histórica + penalidade `KL(π_atual‖π_âncora)` que prende a
   política ao conhecimento da Fase A, evitando o esquecimento catastrófico.

```bash
python3 rl/research.py --run exp1 --arch-isr mlp --arch-egy gnn \
    --seed-isr rl/runs/ISR_v2/ckpt_0150.pt --seed-egy rl/runs/EGY_gnn/ckpt_0150.pt \
    --ancora-isr rl/runs/ISR_v2/ckpt_0150.pt \
    --shaping 0.1 --kl-coef 0.05 --lr-isr 1e-4 --lr-egy 5e-5 \
    --epocas-isr 6 --epocas-egy 2 --frac-isr 0.66 --updates 200
```

Critério de sucesso no dashboard: **ISRvsHeur não cai** de ~1.0 (a KL segura) e
**ISRvsEGY sobe** do ~0 (shaping + assimetria dão ao atacante chance de aprender).
Cada run grava `config.json` com os hiperparâmetros, para comparar experimentos.
Bases aditivas no env/worker (`phi`) não afetam `train.py`/`selfplay.py`.

### Resultado do 1º experimento (`RES_estabilizado`, 200 updates)

shaping 0.1 · KL 0.05 (âncora Fase A) · lr 1e-4/5e-5 · épocas 6/2 · 66% ambientes ISR.

| update | ISR×EGY | ISRvsHeur | EGYvsHeur | KL |
|---|---|---|---|---|
| 25 | 0.58 | 1.00 | 0.88 | 0.21 |
| 100 | 0.00 | 0.75 | 0.96 | 0.33 |
| 125 | 0.00 | **0.00** | 0.88 | 0.33 |
| 200 | 0.17 | **1.00** | 0.88 | 0.39 |

**Conclusão:** as três técnicas **evitaram o colapso permanente** do self-play
ingênuo (que travava o ISR em 0% — §11). A KL-penalty puxou a política de volta à
âncora sempre que degradava (queda no update 125 → recuperação a 100% no fim), e o
shaping deu picos de competitividade no confronto direto (0.58). Mas a estabilidade
ainda não foi alcançada — o ISRvsHeur oscila e o ISR×EGY fica fraco, refletindo a
**vantagem estrutural do defensor** no jogo (um teto do próprio jogo, não da
técnica).

### 2º experimento (`RES_v2`, 250 updates) — ajustes mais agressivos

shaping 0.15 · KL **0.10** · lr 1.5e-4/3e-5 · épocas 8/2 · 70% ambientes ISR · entropia 0.015.

| métrica | self-play ingênuo | RES\_estabilizado | **RES\_v2** |
|---|---|---|---|
| ISR vs heurística | → 0% (travado) | oscila, recupera | **média 0.83; 100% em 28/50 medições** |
| ISR × EGY (direto) | ~0 | pico 0.58 | média 0.24, **pico 0.54** |
| EGY vs heurística | forte | forte | 0.71–0.96 |
| KL(atual‖âncora) | — | até 0.39 | controlada 0.10–0.22 |

**Veredito:** o objetivo declarado — **impedir o colapso do atacante** — foi alcançado.
Com KL 0.10 + assimetria, o ISR vs heurística passa a maior parte em 100% e sempre
se reancora após quedas pontuais (sem tendência de queda; média 0.83). O atacante
ganhou competitividade real no confronto direto (picos recorrentes de 0.46–0.54, vs
~0 do ingênuo). O equilíbrio pleno (ISR×EGY ≥ 0.5 estável) **não** é atingido: é o
teto estrutural do jogo, favorável ao defensor. Produção inalterada (MLP-ISR da Fase
A, 97%); checkpoints do melhor ISR ficam disponíveis em `rl/runs/RES_v2/` para
publicação opcional no menu.

> **Corrigido na revisita (§12e).** Não há evidência de "teto estrutural": os dois
> lados se exploram mutuamente (atacante re-treinado contra o defensor atual vence 87%;
> defensor re-treinado ou com pesos otimizados contra esse atacante o derrota). O
> equilíbrio depende de quem se adapta a quem; a medida adequada é o Nash da população.

## 12b. Menos miopia — expectimax (feito) e MCTS (em curso)

**(1) Expectimax exato na CRT — implementado.** `rules.js` expõe
`valorEsperadoColuna(col)`/`valorEsperadoCombate(atq,def)`: o valor esperado de um
combate sobre a distribuição real de 2d6 (utilidades por efeito DE/DR.../AV...). A
heurística (`ai.js`, flag `YK.IA.usarExpectimax`, default ligado) usa-o no lugar dos
pesos fixos. Matriz de confronto (60 sementes, win% do atacante ISR):

| | win ISR |
|---|---|
| fixo×fixo | 33% |
| EXP-ISR×fixo | 28% |
| fixo×EXP-EGY | 18% |
| EXP×EXP | 13% |

> **Revisita (§12e).** Ligar o expectimax **nos dois lados** como padrão mudou o oponente
> de todas as avaliações posteriores, e os modelos treinados antes (contra o "fixo")
> ficaram fora de distribuição. Com n=600: Israel ganha 7 pp **desligando** o seu e perde
> 12–13 pp quando o Egito liga o dele (efeitos quase aditivos).

Achado: o expectimax **melhora muito o defensor** e **piora levemente o atacante**
(o EV trata coluna "=" como +0,25 → atacante imprudente; falta valor estratégico de
preservar força). A miopia residual do atacante é estratégica → alvo do MCTS.

**(2) Busca — duas tentativas. A 1ª (rollout) falhou; a 2ª (PUCT + valor) venceu o atacante.**

*Tentativa 1 — rollout-até-o-fim (descartada).* `ai-mcts.js` selecionava a ação por
rollouts da heurística até o fim do jogo. Mesmo após corrigir um bug (a fase era
completada com "1ª ação legal" degenerada), ficou **aquém** da heurística:
ISR 0%, EGY 60% (vs baseline 33%/67%), ~70–90 s/partida. Causas: lookahead curto,
poucos rollouts (variância) e — o teto — usar a própria heurística como avaliador,
nunca a superando.

*Tentativa 2 — PUCT + rede como valor (atual).* Reescrito como AlphaZero-lite:
- **prior** = cabeça de política da rede; **avaliação de folha** = cabeça de **valor**
  (crítico do PPO), exposta no interpretador (`ai-neural.js forward → {logits, valor}`,
  paridade Python↔JS de logits **e** valor confirmada a ~1e-8, ver `rl/gen_parity.py`);
- adversário e acaso (CRT 2d6) **dobrados na transição** (heurística joga a rodada do
  oponente, `decisorAuto` resolve combates) → busca de **agente único** sem min/max;
- só a fase de **movimento** é ramificada; combates usam a base.
Modelos com cabeça de valor (prior+valor da busca): `ISR_selfplay.json` e
`EGY_gnn.json`. `rl/export_ckpt.py` re-exporta qualquer checkpoint `.pt` com a cabeça
de valor (mapeia o esquema antigo `tronco/cab_*`→`l1/l2/pi/v`).

> **Achado — em PUCT o VALOR domina, não o prior.** O modelo Fase-A tem política
> gulosa mais forte (25% vs 10% do self-play), mas, usado como motor da busca, rende
> só 17% contra os 33% do self-play: o crítico do self-play está mais bem calibrado e
> avalia melhor as folhas. A qualidade da busca acompanha o **avaliador**, não o ator
> — por isso o motor de valor escolhido é o `ISR_selfplay.json`.

**Resultado maçã-a-maçã (12 seeds, mesmo loop de jogo, vs heurística):**

| lado | heurística | política neural (gulosa) | **PUCT (sim 48, prof. 4)** |
|---|---|---|---|
| ISR (atacante) | 8% | 17% | **33%** |
| EGY (defensor) | **92%** | 67% | 67% |
| custo | ms | ~10 s/partida | ~33 s/partida |

**Veredito honesto:** o PUCT+valor é um **ganho claro no atacante** — quadruplica a
heurística (8%→33%) e dobra a política gulosa (17%→33%): a cabeça de valor dá o
horizonte longo que o rollout não conseguia (vê o payoff de ponte→travessia→objetivos).
No **defensor** a heurística já está perto do teto (92%) e nem a rede nem a busca a
superam (ambas 67%), pois o avaliador (modelo EGY) é mais fraco que a heurística na
defesa e a busca não excede o próprio avaliador. **Recomendação prática: PUCT para
Israel (melhor atacante disponível), heurística para o Egito (melhor defensor).** O
seed-set 8000+ favorece fortemente o defensor (heur×heur dá ISR 8% / EGY 92%),
refletindo a vantagem estrutural do defensor já documentada na pesquisa.

**Teto da busca (escala de simulações + nó de chance).** Variando o esforço do PUCT
(12 seeds): 48 sims = 33%, 96 = 25%, 128/prof.5 = 25% (tudo dentro de 1 jogo); e tratar o
combate como **nó de chance re-amostrado** (expectimax amostral, `CFG.reamostraChance`)
deu 33% a 48 sims — **neutro** e ~40% mais lento (por isso off por padrão). **A busca
satura em ~33%**: jogar mais busca contra o *mesmo* valor tem retorno decrescente. Confirma
"o valor domina" por outro ângulo — com valor fixo, o atacante platôs perto do **máximo
jogável** num jogo pró-defensor. **A única alavanca com folga é a função de valor**
(crítico dedicado em escala, alvos balanceados + bootstrap), não mais busca.

> **Corrigido na revisita (§12e).** Com n=12 o IC é de ±25 pp, então "48=33% > 96=25%"
> não distingue nada, e a "saturação" tem outra causa medida: o PUCT só expande o top-6
> da política, e o lance que a heurística faria está nesse top-6 em só 19% das decisões.
> E o "máximo jogável" não existe: um atacante re-treinado contra o defensor atual vence
> 87% (n=400).

**(3) Loop AlphaZero (auto-jogo com busca → re-treino) — implementado; resultado
assimétrico e instrutivo.** Pipeline completo: a busca expõe π (visitas) com ruído
Dirichlet+temperatura (`ai-mcts.js analisar`); `az_selfplay.mjs` gera registros
`(obs, máscara, π, z)` com os dois lados jogando PUCT; `az_train.py` treina por perda
AlphaZero (CE de política em π + EQM de valor em z), aquecido dos checkpoints PPO;
`az_eval.mjs`/`az.py` orquestram e avaliam. Aquecimento: ISR=RES_v2, EGY=EGY_gnn.

| variante (10 seeds, vs heur.) | ISR | EGY |
|---|---|---|
| baseline (valor PPO) | 30% | 70% |
| AZ ingênuo (política+valor) | 0% | 60% |
| AZ só-valor, auto-jogo lopsided | 0% | **80%** |
| AZ só-valor, **alvos balanceados** (ISR vs heur.) | 10% | — |

**Achados (3 experimentos):** (1) o re-treino ingênuo **degrada** — a política colapsa
ao ser puxada para a π quase-uniforme de poucas simulações; (2) o modo **só-valor**
(congela a política, re-ajusta só a cabeça de valor) isola a causa: com a política
intacta, o **defensor melhora (70→80%)** mas o **atacante cai a 0%**, pois no auto-jogo
PUCT×PUCT (dominado pelo defensor) os registros do ISR são quase todos derrota → o
valor **perde discriminação**; (3) com **alvos balanceados** (ISR vs heurística, ~42%
de vitórias na geração) o atacante **recupera só parcialmente (0→10%), ainda abaixo do
baseline PPO (30%)**. Causa final: o valor do PPO é um estimador **forte e de baixa
variância** (treinado com GAE/bootstrap em milhares de partidas); re-ajustar com alvos
Monte-Carlo crus de **24 partidas** o torna mais ruidoso, e o atacante (linhas de
vitória estreitas) é **sensível à variância** do valor. Para de fato superar o valor
PPO via AZ seria preciso **dados em larga escala + alvos de valor bootstrap**, inviável
a ~10 s/partida numa máquina. **Melhores IAs comprovadas seguem: PUCT (valor PPO) p/
atacante 33%, heurística p/ defensor 92%.** Pipeline AZ completo e pronto em `rl/az_*`
(`az_selfplay.mjs` com `--so_lado` p/ alvos balanceados, `az_train.py --so_valor`,
`az_eval.mjs`, `az.py`) para retomar se houver orçamento de computação.

## 12d. Hierarquia: macro-ações e híbrido com LLM (+ SkillOpt)

**Macro-ações (`web/js/ai-macro.js`).** Em vez de ~90 microdecisões/partida, a busca
decide entre poucos **planos** de alto nível por rodada (horizonte ~6). Um plano
sobrescreve os *alvos* das unidades de combate (pós-ponte) via gancho
`YK.IA.moverComPlano` — o executor de baixo nível é a própria movimentação heurística
(sem duplicar pathfinding). Folhas avaliadas pela cabeça de valor. **Resultado: 17%
vs heurística (dobra os 8% da heurística), platô em prof. 2 = prof. 3** → o teto é o
*executor* (heurística), não a profundidade; abaixo do micro-PUCT (33%).

**Híbrido com LLM (opção A — "LLM propõe, sim/valor verificam").** O gargalo do macro
é o vocabulário fixo de 5 planos. O LLM gera planos adaptativos; o motor + valor
verificam. Peças (`rl/`):
- `llm-planner.mjs` — serializa o estado em texto, chama a API Claude, faz **grounding**
  (descarta hexes ilegais) e converte o JSON em override de alvos. `SKILL_DOC` = o
  prompt-skill (alvo de otimização). Provedor `provedorMock` roda **sem chave**.
- `ai-macro.js setProvedor(fn)` — injeta planos do LLM na raiz; o lookahead recursivo
  usa os planos fixos (sem chamar API no fundo da árvore).
- `llm-eval.mjs` — (2)(3) score = win% + recompensa graduada média em seeds held-out.

**SkillOpt (`rl/skillopt.mjs`) — (4).** Laço leve estilo Microsoft SkillOpt
(arXiv 2605.23904): trata o `SKILL_DOC` como estado treinável. Por iteração: **rollout**
(joga lote com a skill atual), **reflect** (modelo otimizador propõe edição limitada
lendo vitórias×derrotas), **gate** (aceita só se o score subir em seeds held-out). O
encaixe é forte porque temos o **verificador perfeito e barato** (sim+valor) que a
técnica exige.

Verificado de ponta a ponta **com provedor MOCK** (serialização, grounding que descarta
hex ilegal, `llm-eval --mock`, `skillopt --mock` com gate rejeitando candidata sem ganho)
e depois **com API real**. O dispatcher roteia por nome de modelo (`gpt*`/`o[1-9]*` →
OpenAI; `claude*` → Anthropic); chave via `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`LLM_API_KEY`.

**Resultado real (12 seeds held-out, vs heurística):**

| atacante ISR | heur. | gulosa | macro fixo | híbrido gpt-4o-mini | híbrido GPT-5 | micro-PUCT |
|---|---|---|---|---|---|---|
| win% | 8% | 17% | 17% | **25%** | 17% | 33% |

**Achados:** (1) o híbrido LLM fica na faixa do macro fixo (~17–25%), acima de
heurística/gulosa, mas **abaixo do micro-PUCT (33%)**; (2) **um gerador muito mais forte
NÃO ajuda** — GPT-5 (17%, 29 min) ≈ gpt-4o-mini (25%, 7 min), diferença de 1 jogo
(ruído). Isso confirma de forma independente o achado do macro (prof. 2 = prof. 3):
**o gargalo é o EXECUTOR (heurística de baixo nível), não a inteligência estratégica
nem o prompt.** Mais qualidade de plano sem melhor execução não move o teto.
Pipeline (1)→(4) pronto e verificado (`rl/llm-planner.mjs`, `llm-eval.mjs`,
`skillopt.mjs`; dispatcher OpenAI/Anthropic por nome de modelo). Para rodar:
`OPENAI_API_KEY=$(cat ~/.openai_key) node rl/llm-eval.mjs --jogos 12 --model gpt-4o-mini`.
Skill em `rl/skills/v1.txt`.

**Hierarquia de verdade (LLM escolhe o plano → micro-PUCT executa enviesado).**
`web/js/ai-hier.js` + `ai-mcts.js setViesPlano`: o plano de alto nível adiciona atração
pelas casas-alvo ao prior do micro-PUCT. Teste decisivo com **simulações igualadas**:

| atacante ISR (12 seeds) | win% |
|---|---|
| micro-PUCT sozinho (sim 48) | **33%** |
| micro-PUCT sozinho (sim 24) | 25% |
| hierarquia gpt-4o + micro-PUCT (sim 24) | 17% |

**Veredito: a hierarquia NÃO supera o micro-PUCT.** A simulações iguais (24), o viés do
plano levou 25%→17% (1 jogo, ruído — mas **sem ganho**); a queda 33%→25% é só o corte de
sims. **Achado central: o valor da camada estratégica é inverso à força do executor** —
macro/LLM ajuda muito o executor *fraco* (heurística: 8→17→25%) mas é neutro/prejudicial
sobre o executor *forte* (micro-PUCT: 25→17%), pois distorce o prior neural já consciente
de valor (puxa unidades a posições taticamente piores). **A IA mais forte do atacante
segue sendo o micro-PUCT puro (33%).** Linha LLM/hierarquia completa e caracterizada.

> **Revisita (§12e).** Todas as linhas desta tabela têm n=12 (IC ±25 pp): a "lei da
> hierarquia" é uma hipótese plausível, não um resultado estatisticamente estabelecido.
> E foram medidas contra o defensor com expectimax, contra o qual nenhum atacante tinha
> sido treinado.

## 12e. Revisita (set/2026): o oponente mudou, as amostras eram pequenas e os dois lados se exploram

Uma revisão crítica, com avaliação paralela e N grande, derrubou a conclusão de "teto
estrutural ~33%" e reorientou o trabalho dos dois lados. Ferramentas novas:

- `rl/arena.mjs` + `rl/arena-worker.mjs` — avaliação paralela (worker_threads, fila
  dinâmica), cada partida com sua configuração (agente de cada lado + pesos da
  heurística), intervalo de Wilson a 95%. Reproduz bit a bit as execuções sequenciais.
- `web/js/ai.js` — **pesos da heurística por lado** (`setPesos`/`PESOS_PADRAO`), com
  padrões idênticos à heurística original (verificado: 300 partidas idênticas antes e
  depois), doutrina da ponte parametrizada (`ponte*`, `guardaPonte`), raio de caça do
  Egito (`cacaRaio`) e o lance heurístico exposto (`avaliarLances`, `lanceHeuristico`).
- `web/js/ai-mcts.js` — prior do PUCT configurável **por lado** (`politica` | `uniao` |
  `heuristica`), para PUCT×PUCT com configurações diferentes.
- `rl/cem.mjs` — otimização dos pesos por CEM (números aleatórios comuns por geração,
  validação em 1000 seeds nunca vistas, aceita oponente-mistura).
- `rl/env.mjs`/`worker.mjs`/`train.py` — oponente configurável no treino **e** na
  avaliação: pesos da heurística, neural fixo ou **mistura** (PSRO); `--init` aquece a
  partir de checkpoints antigos (esquema `tronco/cab_*`).
- `rl/nash.mjs` + `rl/exp/matriz.mjs` — matriz atacante×defensor e **Nash da população**.

### 12e.1 Diagnóstico

**O oponente mudou no meio do estudo.** Ligar o expectimax nos dois lados (§12b)
fortaleceu muito o defensor heurístico, e todos os números posteriores foram medidos
contra ele — inclusive os de modelos treinados contra o defensor antigo:

| defensor heurístico | heur×heur (ISR vence, n=300) | MLP Fase A, ISR vence (n=150) |
|---|---|---|
| sem expectimax (época do treino) | 29,7% [24,8–35,1] | **86,7%** [80,3–91,2] |
| com expectimax (desde junho) | 15,3% [11,7–19,8] | **14,0%** [9,3–20,5] |

**Amostras pequenas.** Com n=12 o IC de 95% é de ±25 pp. A base real heur×heur é ~15%
(não os 8% de 12 seeds). As comparações de §12b/§12d com n=10–12 não são estatisticamente
distinguíveis entre si.

**Modo de falha do atacante heurístico** (n=300): a ponte é instalada em só **40%** dos
jogos, tarde (rodadas 5–6), e está de pé no fim em **10%**; **68%** dos jogos terminam sem
nenhuma unidade israelense a oeste; 83% sem objetivo. A "vitória egípcia decisiva por
atrito" (88% das vitórias egípcias) é, na prática, falha de travessia (`isrOeste≈0`).
Coerente com isso, trocar a política de baixas (espalhar em vez de eliminar feridas) e
o avanço pós-combate (priorizar objetivo) tem efeito **nulo** (17,0% em todas as
variantes, n=400).

**Candidatos do PUCT.** Em cada decisão de movimento há ~126 lances legais; a política
concentra 74% da massa no seu top-6, mas o lance que a heurística faria está nesse
top-6 em só **19%** das decisões (24% no top-12). O PUCT só refina o "mundo" de uma
política confiante e fraca — causa provável da "saturação" com mais simulações.

### 12e.2 Expectimax por lado e operação da ponte (heurística)

| n=600 | EGY com expectimax | EGY sem |
|---|---|---|
| **ISR com expectimax** | 11,3% [9,0–14,1] | 23,8% [20,6–27,4] |
| **ISR sem** | 18,3% [15,4–21,6] | 31,7% [28,1–35,5] |

Efeitos quase aditivos: o expectimax **atrapalha o atacante** (+7 pp desligando) e
**ajuda muito o defensor** (−12 a −13 pp para Israel). Configuração certa: ISR sem, EGY com.

Operação da ponte do atacante heurístico (n=300 cada, mesmas seeds): **nenhuma variante
melhora de forma significativa.** Guardar a engenharia depois da ponte **piora**
(14% → 9% com 3 guardas: tira força dos objetivos e a ponte continua caindo); as regras
de local (mais perto da engenharia, dos objetivos, misto) pioram (5–9%); o setor sul dá
16,3% (+2 pp, dentro do IC). A taxa de instalação fica em 33–43% **qualquer que seja a
regra**, enquanto o atacante neural re-treinado instala a ponte em ~100% dos jogos: o
gargalo da heurística é a escolta/caminho até o canal, não o local.

### 12e.3 Atacante re-treinado contra o defensor atual

PPO aquecido da Fase A (`--init rl/runs/ISR_v2/ckpt_0150.pt`), MLP, contra a heurística
com expectimax, entropia 0,02, com e sem shaping 0,1. Validação na arena (n=400, seeds
novas, loop completo):

| checkpoint | ISR vence vs defensor atual |
|---|---|
| Fase A (sem re-treino) | 14,0% |
| sem shaping, update 30 | **85,5%** [81,7–88,6] |
| com shaping, update 20 | **86,5%** [82,8–89,5] |
| com shaping, update 30 | **86,8%** [83,1–89,7] → `web/models/ISR_v3.json` |
| com shaping, update 40 | 85,0% [81,2–88,2] |

Em 30 updates o atacante sai de 14% para ~87% contra **exatamente** o defensor em que
tudo "saturava em 33%": era deslocamento de distribuição, não teto. Duas ressalvas: (i)
o treino é **instável** — com shaping colapsou para 0% a partir do update 50; sem
shaping oscila (44–85%) — então o checkpoint é escolhido por validação com N grande;
(ii) as vitórias são sobretudo **marginais** (score ~0,2) e a ponte quase nunca está
de pé no fim (~1%).

### 12e.4 Pesos da heurística por CEM (`rl/cem.mjs`)

Gaussiana diagonal nos pesos normalizados, 16 candidatos/geração em 120 seeds comuns,
seeds novas a cada geração, validação final em **1000 seeds nunca usadas**.

| otimização | antes | depois (validação) | mudanças principais |
|---|---|---|---|
| **ISR** (sem expectimax) vs defensor padrão | 18,6% [16,3–21,1] | **50,8%** [47,7–53,9] | `dist` 10→4,5, `terreno` 2→3, `expRazao` 2→1,6, `ponteObj` 0→0,3 |
| **EGY** (com expectimax) vs ISR re-treinado | EGY 12,9% [11,0–15,1] | **EGY 100%** [99,6–100] | `dist` 10→3,1, `cacaRaio` ∞→10, `apoioEngaja` 80→113, `terreno` 2→4,2 |

Os dois lados convergem para o mesmo ajuste: **menos atração por alvos distantes**
(`dist` ~3–4,5 em vez de 10). No Egito, só as unidades a ≤10 hexes caçam a engenharia;
as demais seguram as posições. Arquivos: `rl/exp/cem_isr_vs_heur.json`,
`rl/exp/cem_egy_vs_isrv3.json` (campo `final`).

### 12e.5 Exploração mútua: matriz e Nash da população

Matriz A (`rl/exp/m2a.json`, n=300 por célula, ISR vence):

| atacante \ defensor | heur. padrão | GNN antigo | GNN re-treinado (`EGY_v2`) |
|---|---|---|---|
| heurística padrão | 13,7% | 13,3% | 9,3% |
| heurística sem expectimax | 14,3% | 13,0% | 8,3% |
| **heurística CEM** | **47,3%** | 14,3% | **12,7%** |
| MLP Fase A | 21,0% | **58,0%** | 4,0% |
| MLP re-treinado (`ISR_v3`) | **89,7%** | 3,3% | **0,0%** |

O atacante de 90% contra a heurística perde para **qualquer** defensor neural (até o GNN
antigo): especializou-se em explorar a heurística. Nash desta população (pesos
multiplicativos, `rl/nash.mjs`): **ISR vence 12,4%**, Israel ≈ heurística CEM (94%),
Egito ≈ GNN re-treinado (99%).

**Passo PSRO** (melhor resposta contra a mistura de Nash do outro lado, via o
oponente-mistura do ambiente):
- Egito: GNN aquecido de `EGY_v2`, contra a mistura israelense → vence **91–97%** nas
  avaliações do treino (`web/models/EGY_psro1.json`).
- Israel: MLP aquecido de `ISR_v3`, contra `EGY_v2` → **0% em todas as 8 avaliações**
  (80 updates): o PPO não encontrou contra-estratégia a esse defensor.

### 12e.6 Candidatos do PUCT e defensor com prior heurístico

**Candidatos (`prior: 'uniao'`).** Mesmo modelo (`ISR_selfplay`), 48 simulações, prof. 4,
contra a heurística padrão, n=200 cada (`rl/exp/m1_puct_candidatos.json`):

| prior do PUCT | ISR vence |
|---|---|
| política (top-6, original) | 23,5% [18,2–29,8] |
| **união (top-6 + lance heurístico)** | **55,0%** [48,1–61,7] |

Acrescentar o lance doutrinário aos candidatos **mais que dobra** o atacante de busca. A
"saturação em ~33%" da §12b vinha da poda de candidatos, não do valor. O mesmo efeito
aparece contra o defensor CEM: o `ISR_v3` guloso faz 0%, o PUCT com o mesmo modelo e
prior em união faz 48,3% [36,2–60,7] (n=60).

Com o modelo re-treinado, a busca em união torna o atacante muito mais **robusto** (n=60):

| defensor | `ISR_v3` guloso | PUCT `ISR_v3`, união (24 sims) |
|---|---|---|
| heurística padrão | 89,7% | 95,0% [86,3–98,3] |
| GNN antigo | 3,3% | 31,7% [21,3–44,2] |
| GNN re-treinado | 0,0% | 16,7% [9,3–28,0] |
| heurística CEM | 0,0% | 48,3% [36,2–60,7] |

**Defensor com prior heurístico (E2): negativo.** PUCT do Egito com valor do `EGY_v2`:
com prior **heurístico** o `ISR_v3` vence 41,7% [30,1–54,3]; com prior de **política**,
3,3% [0,9–11,4]. Contra a heurística CEM de Israel os dois dão ~5%. O atacante
re-treinado aprendeu a explorar a doutrina heurística, e o prior heurístico a reimporta
na busca. Assimetria: para Israel (política fraca) o lance heurístico acrescenta
diversidade útil; para o Egito (política forte) substitui algo bom por algo explorável.

**Nash da população 6×5** (`rl/exp/pop0_nash.json`: 6 atacantes × heur. padrão, GNN
antigo, GNN re-treinado, heur. CEM, PUCT defensor): **ISR vence 16,9%**; Israel joga o
PUCT em união (98%), Egito o GNN re-treinado (99%). Incluir a busca elevou o valor de
equilíbrio de 12,4% para 16,9%.

### 12e.7 População final e Nash (após um passo PSRO)

8 atacantes × 6 defensores, ISR vence (`rl/exp/pop_final_nash.json`; n=300 nas células
heurística/rede, 40–60 nas de busca):

| atacante \ defensor | heur. padrão | heur. CEM | GNN antigo | **GNN re-treinado** | GNN PSRO | PUCT def. (prior heur.) |
|---|---|---|---|---|---|---|
| heurística padrão | 13,7 | 16,0 | 13,3 | 9,3 | 8,7 | 15,0 |
| heurística sem expectimax | 14,3 | 21,0 | 13,0 | 8,3 | 14,3 | 5,0 |
| heurística CEM (vs padrão) | 47,3 | **63,3** | 14,3 | 12,7 | 0,3 | 5,0 |
| heurística CEM (vs GNN) | 42,0 | 31,3 | 14,3 | 16,0 | 3,0 | 11,7 |
| MLP Fase A | 21,0 | 0,3 | **58,0** | 4,0 | 10,0 | 21,7 |
| MLP re-treinado | **89,7** | 0,0 | 3,3 | 0,0 | 9,3 | 41,7 |
| MLP PSRO | 0,0 | 5,3 | 0,0 | 0,0 | 1,7 | 0,0 |
| **PUCT re-treinado (união)** | **95,0** | 48,3 | 31,7 | **16,7** | 25,0 | **77,5** |

**Nash: ISR vence 17,0%** (gap 0,5 pp). Israel joga o PUCT em união (98%); Egito o GNN
re-treinado (97%) + GNN PSRO (2%). O passo PSRO quase não moveu o valor (16,9% → 17,0%):
- a melhor resposta **neural** de Israel contra o GNN re-treinado **colapsou** (0% até
  contra a heurística padrão) — o ajuste por PPO destruiu o que a rede sabia;
- a melhor resposta **heurística** (CEM) contra o mesmo GNN subiu de 11,6% para 19,2%
  (validação, n=500), mas cai a 3% contra o GNN PSRO;
- a melhor resposta do Egito (GNN PSRO) anula a heurística CEM de Israel (0,3%), mas
  cede mais ao PUCT (25% contra 16,7% do GNN re-treinado).

Os agentes de equilíbrio são também os mais **robustos**: o PUCT em união é a melhor
linha em quase todas as colunas; contra o GNN re-treinado nenhum atacante passa de 17%.

### 12e.8 O que mudou no jogo

- **IA Busca**: Israel usa `ISR_v3` com candidatos em **união**; Egito usa `EGY_v2`
  com prior de **política** (`ai-mcts.js`, `URL_VALOR` e `CFG.lado`).
- **Menu da IA Neural** (`web/models/manifest.json`): `ISR_v3`, `EGY_v2` e `EGY_psro1`
  acrescentados, e todos os rótulos refeitos com números **contra a heurística atual**
  (os antigos "97%/100%" eram contra a de pesos fixos).
- A **heurística padrão não mudou** (os pesos otimizados ficam nos `rl/exp/cem_*.json`),
  para não mover de novo o oponente de referência. Verificado: jogo carrega sem erros no
  navegador e compila os modelos novos; motor 78/78, conformidade 133/133, paridade ok.

### 12e.9 Conclusões da revisita

1. **Não há teto estrutural de ~33%.** Era um oponente que mudou (expectimax ligado nos
   dois lados) somado a amostras de 12 jogos.
2. **O oponente faz parte do resultado.** Uma mudança de avaliação move uma política fixa
   de 87% para 14%; um reajuste por CEM leva um atacante forte a 0%. Um número contra uma
   heurística diz tanto sobre a heurística quanto sobre o agente.
3. **A busca é limitada pelo que ela considera.** Um único lance doutrinário nos
   candidatos dobra o PUCT do atacante; no defensor, o prior heurístico reimporta a
   doutrina que o atacante aprendeu a explorar.
4. **O equilíbrio é propriedade de uma população.** Todo agente treinado contra um único
   oponente foi explorável. No Nash da população o defensor mantém vantagem clara
   (atacante ~17%), agora como afirmação sobre estratégias com melhores respostas.
5. **O modo de falha do atacante heurístico é a travessia**, não as baixas nem o local da
   ponte: a rede re-treinada instala a ponte em ~100% dos jogos; a heurística, em 40%.

Reproduzir: `node rl/arena.mjs ...`, `node rl/cem.mjs ...`, `node rl/exp/matriz.mjs
rl/exp/<cfg>.json`, `node rl/exp/juntar.mjs <saida> <res...>`,
`python3 rl/train.py ... --init ... --oponente ...` (configs em `rl/exp/`).

## 13. Jogar contra os modelos (menu do jogo)

A tela inicial tem **seleção independente por lado**: Israel e Egito podem ser
Humano, IA Heurística ou IA Neural (com escolha do modelo, listado em
`web/models/manifest.json`). Para publicar um modelo treinado, copie o
`policy.json`/`ISR.json`/`EGY.json` do run para `web/models/` e adicione uma
entrada ao manifesto.

### Integração ao jogo (etapa 6)

A política treinada virou um **adversário jogável** no navegador, sem servidor:

- [`web/js/rl-core.js`](../web/js/rl-core.js) — núcleo de codificação (fila de
  microdecisões, observação, máscara) compartilhado entre o treino (`env.mjs` o
  importa) e o jogo. **Fonte única** → a rede vê no jogo o mesmo formato do treino.
- [`web/js/ai-neural.js`](../web/js/ai-neural.js) — carrega `policy.json` via
  `fetch`, faz o *forward* da rede em JS puro (camada densa esparsa, ~1 ms/decisão)
  e expõe `YK.IANeural.jogarFase(state)` — mesma assinatura da IA heurística.
- `web/models/ISR.json` e `web/models/EGY.json` — os pesos treinados (cópia dos
  `policy.json`), carregados sob demanda.
- Na tela inicial, o seletor **"Tipo de adversário IA"** troca entre Heurística e
  Neural; os modelos baixam só quando o modo Neural é escolhido.

Validação: a refatoração para `rl-core.js` foi confirmada medindo as taxas de
vitória antes/depois (inalteradas), e a IA Neural roda partida completa no
navegador sem erros de console. Pendência conhecida: cada modelo tem ~15 MB
(o `W1` domina); quantizar para int8 reduziria a ~4 MB no total — adiar até medir
a degradação.

## 9. Resultados da Fase A (treino vs IA heurística)

Duas execuções de 150 updates (32 ambientes paralelos, ~40 min cada nesta máquina,
~14 núcleos). Meta era >60% de vitória; ambos superaram com folga.

| Lado | Run | Vitória (100 partidas, greedy) | Composição | Arco |
|---|---|---|---|---|
| **ISR** | `ISR_v1`→`ISR_v2` | **97%** | 92 marginal · 5 parcial | 0% nos primeiros 40 updates → descobre a cadeia ponte→travessia→objetivos → ~100% a partir do update 105 |
| **EGY** | `EGY_v1` | **100%** | **95 decisiva** · 5 parcial | já vence cedo (lado defensivo); aprende a *converter* vitórias parciais em decisivas: dec 17%→50%→**96%** entre os updates 5 e 90 |

Leitura: o desafio israelense é **aprender a vencer** (encadear a operação anfíbia
contra um defensor competente); o desafio egípcio é **aprender a vencer melhor**
(deixar de só negar objetivos e passar a aniquilar o atacante na margem oeste —
a curva `ev_decisiva` no dashboard sobe nitidamente). Os números refletem partidas
contra a heurística fixa; a Fase B (self-play) mede políticas uma contra a outra.

## 8. Como usar

```bash
# treinar (uma execução por lado); acompanhe a evolução no dashboard
python3 rl/train.py --side ISR --updates 200 --procs 8 --envs 4
python3 rl/train.py --side EGY --updates 200 --procs 8 --envs 4
open rl/runs/<run>/dashboard.html       # atualiza sozinho a cada 15 s

# retomar um treino interrompido (carrega o último checkpoint do run:
# rede + otimizador + contadores; --updates é o alvo TOTAL)
python3 rl/train.py --run <run> --side ISR --resume --updates 300

# jogar com um checkpoint treinado contra a heurística
node rl/play-checkpoint.mjs rl/runs/<run>/policy.json 50 ISR

# smoke tests
node rl/random-agent.mjs 10
python3 rl/train.py --run fumaca --updates 3 --procs 2 --envs 2 --passos 64
```

O dashboard mostra, por update: taxa de vitória greedy contra a heurística
(decomposta por tipo de vitória), recompensa média dos episódios coletados,
entropia da política (deve cair conforme ela se decide), perda de valor e
episódios acumulados — a "evolução do jogador" em seis gráficos.
