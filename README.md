# A Guerra do Yom Kippur — versão digital e estudo de RL

Adaptação digital jogável do wargame de tabuleiro **A Guerra do Yom Kippur**
(Wargame II), que simula a travessia israelense do Canal de Suez em outubro de 1973,
acompanhada de um estudo completo de aprendizado por reforço (RL) sobre o jogo e de
um paper descrevendo os resultados.

O projeto tem três partes:

1. **O jogo** (`web/`): tabuleiro, peças, tabelas de combate e regras reconstruídos a
   partir da documentação original; roda no navegador, sem build nem dependências.
2. **As IAs**: heurística, redes neurais treinadas por PPO e busca PUCT com valor
   aprendido, todas jogáveis no próprio jogo.
3. **O estudo de RL** (`rl/`, `paper/`): treino, busca, AlphaZero, abstração temporal
   com LLM e uma auditoria da avaliação com equilíbrio de Nash da população.

---

## Como rodar o jogo

Requisito: **Python 3** (só como servidor de arquivos estáticos; já vem no macOS e
na maioria dos Linux).

```bash
./run-local.sh            # serve web/ e abre http://localhost:8080
./run-local.sh 9000       # porta alternativa
```

Sem o script, o equivalente é:

```bash
cd web && python3 -m http.server 8080
```

e abrir `http://localhost:8080` no navegador.

> **Não abra `web/index.html` direto do disco** (`file://`). O navegador bloqueia o
> carregamento dos modelos neurais por `fetch`, e as opções **IA Neural** e **IA Busca**
> deixam de funcionar. A heurística e o jogo entre humanos funcionam, mas use o servidor.

### Escolhendo quem joga

Na tela inicial, cada lado (**Israel** e **Egito**) é configurado de forma
independente:

| opção | o que é | velocidade |
|---|---|---|
| **Humano** | você joga pelo navegador | — |
| **IA Heurística** | regras de doutrina com pontuação de lances | instantânea |
| **IA Neural** | política treinada por RL; escolha o modelo na lista | instantânea |
| **IA Busca** | busca PUCT guiada por rede neural (a IA mais forte) | alguns segundos por jogada |

Combinações úteis:

- **Humano × Humano** no mesmo computador;
- **Humano × IA** jogando de Israel ou do Egito;
- **IA × IA** para assistir a uma partida (o modo passo a passo mostra cada lance e
  destaca no tabuleiro os hexágonos envolvidos em cada combate).

Para o adversário mais forte, use **IA Busca** no lado da máquina. Ela usa os agentes
de equilíbrio da população (ver [Resultados](#resultados-principais)): Israel com o
modelo re-treinado e candidatos em união; Egito com o GNN re-treinado.

O botão de instruções dentro do jogo mostra cada peça dos dois lados e o significado
dos números, o contexto histórico, os pontos de entrada e os reforços.

## O jogo em resumo

- **6 rodadas**, cada uma com 8 fases: movimentação, designação de ataques, cobertura
  defensiva e resolução, primeiro Israel, depois Egito. O combate é obrigatório.
- **Israel** entra pelo leste (casas 2505 e 1922), instala uma ponte sobre o canal com
  a unidade de **engenharia** e atravessa para cumprir os objetivos: destruir ou
  capturar as 3 bases **SAM**, controlar as duas entradas de **Ismaília** (0803 e 1202)
  e uma entrada de **Fahid** (0621 ou 0722). A ponte libera reforços israelenses na
  rodada seguinte.
- **Egito** vence impedindo esses objetivos, com vitória decisiva se Israel perder mais
  unidades do que mantiver na margem oeste.
- **Combate**: razão de forças → coluna (−2 a +2) → 2d6 na Tabela de Efeitos de
  Combate; terreno dá bônus defensivo; unidades feridas viram a peça e são eliminadas
  na segunda baixa.

As regras completas, extraídas da documentação original, estão em
[`REGRAS.md`](REGRAS.md).

---

## O que foi feito

### 1. Reconstrução do jogo

- **Tabuleiro** (538 hexágonos, grade flat-top, 7 tipos de terreno) extraído do mapa
  original por classificação de cores e revisado manualmente: estradas, pontes, o
  Canal de Suez, os lagos e o canal de água doce, modelado como elemento de **aresta**
  entre hexágonos, como no mapa. Gerador: `work/build_mapdata.py` →
  `web/js/map-data.js` (edite sempre o gerador, nunca o JS gerado).
- **Peças**: as 45 unidades (24 egípcias, 21 israelenses) renderizadas como nas folhas
  originais.
- **Motor de regras** (`web/js/rules.js`, `game.js`): movimento, zonas de controle,
  combate, recuo, baixas, ponte, reforços e vitória.
- **Testes**: 78 testes do motor e 133 verificações de conformidade às regras.

### 2. IAs e aprendizado por reforço

- **Heurística** (`web/js/ai.js`): doutrina por alvos de cada unidade e pontuação de
  lances; joga os dois lados. Os pesos são parametrizados por lado.
- **Ambiente de RL** vetorizado sobre o próprio motor do jogo, com espaço de ação
  mascarado e decomposto em microdecisões (`rl/env.mjs`, `worker.mjs`,
  `web/js/rl-core.js`).
- **PPO** com três arquiteturas: MLP, CNN sobre a grade hexagonal e GNN sobre a
  topologia exata do tabuleiro (`rl/nets.py`, `train.py`). Um interpretador em
  JavaScript roda qualquer uma delas no navegador, com paridade numérica verificada
  contra o PyTorch (`web/js/ai-neural.js`, `rl/test-parity.mjs`).
- **Self-play em liga** com shaping por potencial, assimetria e âncora de KL
  (`rl/selfplay.py`, `research.py`).
- **Busca PUCT** com prior e valor da rede, oponente e acaso embutidos na transição
  (`web/js/ai-mcts.js`), e um **laço AlphaZero** de auto-jogo e re-treino
  (`rl/az_*`).
- **Abstração temporal**: macro-ações, um estrategista LLM que propõe planos verificados
  pelo simulador e uma hierarquia LLM + PUCT (`web/js/ai-macro.js`, `ai-hier.js`,
  `rl/llm-planner.mjs`, `rl/skillopt.mjs`).

### 3. Revisita da avaliação (set/2026)

Uma auditoria com avaliação paralela e amostras grandes corrigiu conclusões anteriores
e cobriu as alavancas de melhoria dos dois lados:

- **Arena paralela** (`rl/arena.mjs`): joga partidas completas em todos os núcleos e
  reporta intervalos de Wilson a 95%, com ao menos 300 partidas por condição.
- **O oponente tinha mudado no meio do estudo**: ligar o *expectimax* na heurística
  fortaleceu muito o defensor, e o aparente "teto de 33%" do atacante era esse
  deslocamento somado a amostras de 12 partidas.
- **Re-treino do atacante** contra o defensor atual: de 14% para 87%.
- **Candidatos da busca**: incluir o lance heurístico entre os candidatos do PUCT
  levou a busca de 23,5% para 55%.
- **Otimização dos pesos** da heurística por método da entropia cruzada (`rl/cem.mjs`).
- **Treino contra oponente fixo, neural ou mistura** (`train.py --oponente`), usado
  numa iteração de **PSRO**.
- **Matriz atacante × defensor e Nash da população** (`rl/exp/`, `rl/nash.mjs`).

O relato completo está no paper (seção *Revisiting the Evaluation*) e em
[`rl/RL.md`](rl/RL.md) §12e.

## Resultados principais

Taxa de vitória de Israel (IC de 95%, n = 300 salvo indicação):

| confronto | Israel vence |
|---|---|
| heurística × heurística (configuração atual) | 15,3% [11,7–19,8] |
| MLP antigo × heurística atual | 14,0% |
| MLP **re-treinado** contra o defensor atual × heurística | 86,8% [83,1–89,7] |
| heurística de Israel com pesos otimizados × heurística | 50,8% [47,7–53,9] (n = 1000) |
| PUCT, candidatos da política (top-6) × heurística | 23,5% (n = 200) |
| PUCT, candidatos em **união** × heurística | 55,0% (n = 200) |

Mas **todo agente treinado contra um único oponente é explorável**: o atacante de 87%
perde as 1000 partidas de validação para um defensor heurístico com pesos
reajustados, e perde para qualquer defensor neural. Por isso o resumo adequado do jogo
é o **equilíbrio de Nash de uma população** de 8 atacantes e 6 defensores, depois de
uma iteração de PSRO: **Israel vence 17%**, jogando o PUCT em união, contra o GNN
re-treinado do Egito. O defensor mantém a vantagem.

---

## Reproduzir o estudo de RL

Requisitos: **Node.js ≥ 18** (usado com a 25) e **Python 3** com **PyTorch** e
**NumPy** (usado com torch 2.12 e numpy 2.4).

```bash
# testes
node tests/test.mjs              # motor (78 testes)
node tests/compliance.mjs        # conformidade às regras (133 verificações)
node rl/test-parity.mjs          # paridade Python↔JS (logits e valor)

# treino PPO (ex.: atacante contra o defensor atual, aquecido de outro checkpoint)
python3 rl/train.py --side ISR --arch mlp --updates 150 --procs 4 --envs 4
python3 rl/train.py --side EGY --arch gnn --oponente '{"tipo":"neural","modelo":"web/models/ISR_v3.json"}'

# exportar um checkpoint para o navegador (política + valor)
python3 rl/export_ckpt.py rl/runs/<run>/ckpt_0030.pt web/models/<nome>.json mlp

# avaliação paralela com intervalo de confiança
node rl/arena.mjs --isr '{"tipo":"neural","modelo":"web/models/ISR_v3.json"}' --egy heur --n 300

# otimização dos pesos da heurística
node rl/cem.mjs --lado ISR --oponente heur --fixo '{"expectimax":false}'

# matriz atacante × defensor e Nash
node rl/exp/matriz.mjs rl/exp/m2a.json 8
node rl/exp/juntar.mjs saida.json rl/exp/m2a_res.json rl/exp/m2b_res.json ...
```

As configurações e os resultados de todos os experimentos da revisita estão em
`rl/exp/`. As partes com LLM (`rl/llm-*.mjs`, `rl/skillopt.mjs`) precisam de
`OPENAI_API_KEY` ou `ANTHROPIC_API_KEY` no ambiente. Comandos e detalhes de cada
linha de pesquisa: [`rl/RL.md`](rl/RL.md); explicação visual:
[`rl/explicacao.html`](rl/explicacao.html).

## Paper

- [`paper/paper.pdf`](paper/paper.pdf) — versão em inglês, formato NeurIPS
  (fonte em `paper/paper.tex`; compile com `tectonic paper/paper.tex`).
- [`PAPER.md`](PAPER.md) — versão em português.

## Implantação na AWS

S3 (bucket privado) + CloudFront (OAC) via CloudFormation:

```bash
cd deploy/aws
AWS_PROFILE=meu-profile ./deploy.sh
```

O script cria ou atualiza a stack `yom-kippur-game`, sincroniza `web/` para o bucket,
invalida o cache e imprime a URL pública. Para remover: esvazie o bucket e apague a
stack (`aws cloudformation delete-stack --stack-name yom-kippur-game`).

## Estrutura

```
web/                     o jogo (HTML/CSS/JS puro, sem build)
  js/map-data.js         tabuleiro gerado (538 hexágonos, estradas, canais)
  js/units.js            as 45 peças
  js/rules.js, game.js   motor de regras e máquina de fases
  js/ai.js               IA heurística (pesos por lado)
  js/rl-core.js          codificação de estado/ação compartilhada entre treino e jogo
  js/ai-neural.js        interpretador das redes (MLP/CNN/GNN)
  js/ai-mcts.js          busca PUCT
  js/ai-macro.js, ai-hier.js   macro-ações e hierarquia
  js/ui.js               tabuleiro SVG e interface
  models/                modelos exportados + manifest.json (menu da IA Neural)
rl/                      ambiente, treino, busca, AlphaZero, LLM, arena, CEM, Nash
  exp/                   configurações e resultados da revisita
tests/                   testes do motor e de conformidade
paper/                   paper (LaTeX, PDF, figura do tabuleiro)
work/build_mapdata.py    gerador do tabuleiro (+ mapdata_raw.json)
deploy/aws/              CloudFormation + script de deploy
REGRAS.md, IA.md         regras completas e explicação da IA heurística
```

### Fora do repositório

- `rl/runs/` — checkpoints de treino (3,8 GB); os modelos usados estão exportados em
  `web/models/`.
- `files/` — documentação original digitalizada do jogo (material de terceiros).
- `work/` — imagens e artefatos da extração do mapa (150 MB); só o gerador e os dados
  brutos são versionados.

## Notas de fidelidade

- O terreno foi extraído do scan original e revisado à mão (estradas, canais, cidades
  e posições iniciais).
- O canal de água doce corre **entre** os hexágonos, como aresta, com o traçado do mapa
  original; atravessá-lo custa +3, exceto nas pontes de estrada.
- Simplificação: a rendição antecipada não foi implementada; as partidas vão até a
  rodada 6.
