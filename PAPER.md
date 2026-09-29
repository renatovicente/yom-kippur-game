# Reinforcement Learning num Wargame Histórico de Informação Perfeita e Assimétrico: A Guerra do Yom Kippur

**Resumo (Abstract)**

Apresentamos um estudo de caso completo de aprendizado por reforço (RL) sobre um
wargame de tabuleiro histórico — *A Guerra do Yom Kippur* — reconstruído digitalmente
a partir de seus componentes originais (mapa, peças e tabelas de combate). O jogo é
de informação perfeita, com aleatoriedade restrita à resolução de combates por dados
(2d6), episódios curtos (6 rodadas, ~90 microdecisões por lado) e forte
**assimetria** entre um atacante (Israel) que precisa encadear uma operação anfíbia
de longo alcance e um defensor (Egito) reativo e localmente vantajoso. O ambiente
vetorizado é construído sobre o próprio motor de regras do jogo, com espaço de ação mascarado e
decomposto em microdecisões. Treinamos políticas por PPO com três arquiteturas: um MLP,
uma CNN sobre a grade hexagonal e uma GNN sobre a topologia exata do tabuleiro. Um
interpretador agnóstico de arquitetura as serve no navegador, com paridade numérica
verificada. O estudo acrescenta depois busca PUCT com valor aprendido, um laço
no estilo AlphaZero e abstração temporal com um estrategista baseado em LLM. Os
resultados sobre adequação arquitetura–papel e sobre o colapso do self-play ingênuo
foram medidos contra o oponente heurístico da época e aparecem como tais.

**Uma auditoria posterior da avaliação inverte a principal conclusão negativa do estudo.** O
oponente heurístico mudou no meio do trabalho e a maior parte das comparações usava 12
partidas, de modo que o aparente teto de ~33% para o atacante era um artefato.
Re-treinado contra o defensor atual, o atacante vence 87% em vez de 14%. Incluir o lance
da heurística entre os candidatos do PUCT eleva a busca de 23,5% para 55%, e ajustar os
pesos da heurística pelo método da entropia cruzada quase triplica o atacante
heurístico. Todo agente treinado contra um único oponente, porém, perde para alguma
contra-estratégia: o atacante de 87% perde as 1000 partidas de validação para um
defensor heurístico com pesos reajustados. Por isso resumimos o jogo pelo **equilíbrio
de Nash de uma população** de oito atacantes e seis defensores após uma iteração de
PSRO, no qual o atacante vence 17%. O jogo, o ambiente, o treinador, a busca, a arena de
avaliação e os modelos ficam disponíveis como artefato reprodutível.

---

## 1. Introdução

Jogos de tabuleiro têm servido há décadas como bancos de prova para tomada de decisão
sequencial. Wargames operacionais hexagonais (*hex-and-counter*), porém, são
relativamente pouco explorados por RL apesar de propriedades atraentes: regras
discretas e bem definidas, horizonte curto, e — no caso aqui estudado — **assimetria
estrutural** entre os lados, que expõe dificuldades de RL multiagente raramente
visíveis em jogos simétricos como Go ou Xadrez.

Estudamos *A Guerra do Yom Kippur* (Wargame II), uma simulação da travessia israelense
do Canal de Suez em outubro de 1973. O General Israelense (atacante) dispõe de 6
rodadas para destruir baterias antiaéreas (SAM), estabelecer uma cabeça-de-ponte na
margem oeste e controlar entradas de cidades; o General Egípcio (defensor) busca
impedi-lo. A operação histórica foi notavelmente audaciosa precisamente porque a
posição favorecia o defensor — uma assimetria que se reflete na dinâmica de RL.

Nossas contribuições:

1. Um **ambiente de RL fiel ao motor de regras de produção** (o mesmo código que roda
   o jogo jogável), eliminando divergências entre treino e implantação.
2. Um **espaço de ação por microdecisões com máscara de legalidade** derivada do
   próprio motor, tornável tratável um turno combinatório (mover até 19 unidades).
3. Um **interpretador de camadas agnóstico de arquitetura** que permite treinar
   MLP/CNN/GNN em PyTorch e servir qualquer delas em JavaScript puro no navegador, com
   paridade numérica testada.
4. Uma **busca PUCT estilo AlphaZero com valor aprendido** (oponente e acaso dobrados na
   transição, folhas avaliadas pelo crítico do PPO) e um laço completo de re-treino por
   auto-jogo, ambos executáveis no navegador/Node a partir das mesmas redes exportadas.
5. Achados empíricos sobre **adequação arquitetura↔papel**, **colapso do self-play em
   jogos assimétricos** e sua **mitigação parcial**, e **busca dominada pelo valor**: o
   PUCT fortalece o atacante, mas seus ganhos — e os do refino AlphaZero — são limitados
   pelo avaliador, não pelo prior.

## 2. Trabalhos Relacionados

Métodos de self-play com busca em árvore (AlphaZero e sucessores) atingiram
desempenho sobre-humano em jogos de tabuleiro simétricos de informação perfeita. PPO
estabeleceu-se como linha de base robusta para controle por políticas. Em RL
multiagente, o self-play ingênuo é conhecido por instabilidades (ciclos não
transitivos, esquecimento catastrófico), motivando ligas de oponentes e *fictitious
play*. *Reward shaping* baseado em potencial fornece sinal denso sem alterar a política
ótima. Penalidades de divergência (KL) contra uma política de referência são usadas
para limitar deslocamento e preservar conhecimento. Nosso trabalho não propõe novos
algoritmos; combina técnicas conhecidas num domínio assimétrico pouco estudado e
documenta os fenômenos resultantes, com ênfase em reprodutibilidade e implantação.

## 3. O Jogo como Ambiente de RL

### 3.1 Domínio

O tabuleiro é uma grade hexagonal de **538 casas válidas** (colunas 1–25, linhas
1–22; topologia *flat-top* com colunas pares deslocadas), com **1521 arestas de
adjacência**. Sete tipos de terreno modulam custo de movimento e bônus defensivo;
estradas, o Canal de Suez e um canal de água doce são *features* de aresta. Cada lado
controla batalhões com Índice de Combate (IC) e Índice de Mobilidade (IM); unidades
sofrem baixas (viram o verso, com valores reduzidos) e são eliminadas na segunda
baixa.

Uma rodada tem **8 fases** (movimentação, designação de ataques, cobertura defensiva e
resolução, primeiro para Israel, depois para o Egito). Combates entre unidades
adjacentes são **obrigatórios**; o resultado vem da razão de forças (com terreno),
mapeada a uma coluna (−2 a +2) de uma Tabela de Efeitos consultada por 2d6. A única
fonte de aleatoriedade é essa rolagem. As condições de vitória são assimétricas e
graduadas (decisiva/parcial/marginal) por lado.

### 3.2 Formulação do PDM

- **Episódio:** uma partida (6 rodadas).
- **Decisão (passo):** uma microdecisão — destino de uma unidade, casa de entrada de
  reforço, ou alvo de apoio de artilharia.
- **Ação:** inteiro em {0,…,537} (índice de casa) ∪ {PASSAR}, totalizando **539**
  ações. A semântica da casa depende da decisão corrente (mover/entrar/apoiar).
- **Máscara:** vetor binário de ações legais, obtido diretamente do motor
  (`alcance`, `casasEntrada`, `artilhariasDisponiveis`); a política nunca explora
  jogadas ilegais.
- **Observação:** 20 planos de 538 casas (terreno *one-hot*, estradas, margem,
  objetivos, SAMs; por lado: presença, IC, IM, baixas, artilharia pronta) + 8
  escalares (rodada, fase, ponte, reservas, perdas, lado), totalizando 10.776 valores.
  A observação é **relativa ao lado que decide**.
- **Recompensa:** terminal, graduada pela vitória — decisiva ±1,0, parcial ±0,6,
  marginal ±0,3, empate 0; γ=1 dado o horizonte curto.

As escolhas de baixa importância tática durante a resolução (qual unidade sofre baixa,
direção de recuo) são delegadas a uma heurística, mantendo o espaço de ação focado nas
decisões estratégicas.

### 3.3 Arquitetura do sistema

O motor de regras (JavaScript) é compartilhado entre o jogo jogável e o treino. Um
processo Node expõe **K ambientes vetorizados** por linha de comando (protocolo
JSON-lines, observações/máscaras em base64); o treinador Python aciona **M processos ×
K ambientes** em lockstep. Medimos ~700–1700 decisões/s por configuração em CPU de 14
núcleos, suficiente para PPO neste porte de jogo. A reutilização do motor de produção
garante que a política veja, no treino, exatamente o que verá ao jogar.

## 4. Método

### 4.1 Arquiteturas

Três políticas com a interface comum `(obs, máscara) → (logits[539], valor)`:

| Arquitetura | Tronco | Parâmetros |
|---|---|---|
| MLP | duas camadas densas sobre o vetor de observação | 2.861.468 |
| CNN | duas convoluções 3×3 sobre a grade 22×25 (espalhamento por *offset*) | 18.339 |
| GNN | duas camadas de *message-passing* sobre o grafo de adjacência hexagonal | 6.691 |

CNN e GNN compartilham pesos no espaço, sendo **duas a três ordens de grandeza
menores** que o MLP. Cabeças de política produzem 1 logit por casa (convolução 1×1 /
linear por nó) mais um logit de PASSAR; cabeças de valor partem de um *pooling* global
concatenado aos escalares. A máscara é aplicada somando −∞ aos logits ilegais.

### 4.2 Treino (PPO) e implantação

Treinamos por PPO com vantagem estimada contra uma linha de base de valor, *clipping*,
e bônus de entropia. As políticas são exportadas como uma **lista de camadas
executáveis** (`linear`, `conv`, `gnn`, cabeças), interpretada tanto pelo treino
quanto por um motor de inferência em JavaScript puro — permitindo jogar contra
qualquer arquitetura no navegador, sem dependências. Um teste de paridade confirma
que os 539 logits do interpretador coincidem com o PyTorch (erro máximo < 10⁻⁸).

### 4.3 Self-play e estabilização

No self-play, ambos os lados são políticas em treino, com **liga** de checkpoints
congelados (parte dos ambientes enfrenta versões históricas do oponente, *fictitious
play*) e crédito por trajetória (γ=1, recompensa terminal). Para conter a degradação
do atacante (Seção 6.2), combinamos três técnicas:

- **Shaping baseado em potencial:** Φ(s) cresce com o progresso do atacante (ponte
  instalada, SAMs neutralizadas, objetivos controlados, unidades na margem oeste). Com
  γ=1, o retorno telescopa para `R_terminal + α·(Φ_final − Φ_t)`, preservando o ótimo.
- **Self-play assimétrico:** mais épocas de gradiente, taxa de aprendizado e fração de
  ambientes para o lado fraco; o lado forte aprende mais devagar.
- **Penalidade de KL contra âncora:** β·KL(π_atual‖π_âncora), com a âncora sendo a
  política de currículo do atacante, limitando o esquecimento catastrófico.

## 5. Configuração Experimental

Currículos de Fase A treinam cada lado contra uma IA heurística fixa (regras táticas
escritas à mão) por 150–200 *updates* (32 ambientes paralelos). A avaliação é *greedy*,
em 24–100 partidas com sementes reservadas, reportando taxa de vitória decomposta por
tipo. Para o self-play, semeamos as políticas com os melhores currículos de cada lado.
Hiperparâmetros principais: lr 3·10⁻⁴ (currículo), *clip* 0,2, λ_GAE 0,95, entropia
0,01–0,03. Sementes fixas tornam as partidas reproduzíveis.

## 6. Resultados

### 6.1 Adequação arquitetura ↔ papel (vs. heurística)

| Lado | MLP (2,86 M) | CNN (18 k) | GNN (6,7 k) |
|---|---|---|---|
| **Egito** (defensor; reativo, local) | 100% | — | **92%** |
| **Israel** (atacante; planejamento de longo alcance) | **97%** | 0% | 0% |

O lado egípcio, defensivo e de decisões locais, é resolvido com folga por redes
pequenas e espacialmente estruturadas — a GNN atinge 92% com **400× menos parâmetros**
que o MLP, gerando um modelo de ~35 KB (vs. ~15 MB). O lado israelense, que exige
encadear ponte → travessia → captura de objetivos espalhados, **só é dominado pelo
MLP de alta capacidade**; CNN e GNN convergem prematuramente (entropia → 0 por volta do
*update* 100) a um ótimo local de "perder por margem menor" (recompensa ~−0,6),
nunca vencendo. Interpretamos isso como uma incompatibilidade entre a capacidade/viés
indutivo das redes pequenas e a natureza de horizonte longo da tarefa atacante.

### 6.2 Colapso do self-play ingênuo

Partindo das políticas de currículo (ISR 97%, EGY 92–100% vs. heurística), o self-play
sem mitigação **degrada monotonicamente o atacante**: sua taxa vs. heurística cai de
97% para 0% e o confronto direto ISR×EGY fica em ~0. O defensor, estruturalmente
favorecido, vence quase sempre; sem sinal de recompensa positivo, o gradiente do
atacante o afasta de qualquer competência prévia (esquecimento catastrófico).

### 6.3 Estabilização

Com shaping (α=0,1), KL (β=0,05) e self-play assimétrico, o colapso permanente é
evitado. Em um experimento de 200 *updates*, a taxa do atacante vs. heurística oscila
mas **recupera-se a 100%** (a penalidade de KL o reancorra sempre que degrada), e o
confronto direto atinge picos de 0,58 — contra ~0 estável do caso ingênuo. A
estabilidade plena, contudo, não é alcançada: a vantagem estrutural do defensor impõe
um teto ao equilíbrio competitivo, e as métricas seguem oscilando. Concluímos que as
técnicas resolvem o problema declarado (evitar o colapso) mas não tornam o jogo
simétrico — um limite do domínio, não da técnica.

### 6.4 Busca PUCT com valor aprendido; o valor domina o prior

Adicionamos busca em tempo de jogo (estilo AlphaZero). Em cada microdecisão de
movimento, uma árvore PUCT usa a **cabeça de política** como *prior* e a **cabeça de
valor** (crítico do PPO, treinado para prever o desfecho graduado) para **avaliar as
folhas** — sem rollout até o fim. O oponente e o acaso (CRT 2d6) são **dobrados na
transição** (a heurística joga a rodada adversária; o motor resolve o combate),
tornando a busca de **agente único**, sempre na nossa perspectiva, sem min/max. A
seleção é `Q + c_puct·P·√ΣN/(1+N)`; padrões `c_puct=1,5`, `topK=6`, 48 simulações,
profundidade 4 rodadas. A paridade Python↔JS é estendida e confirma **logits e valor**
a `<1e-8`.

Comparação maçã-a-maçã (12 *seeds* retidas, mesmo loop de jogo; *seeds* que favorecem
fortemente o defensor — heur×heur dá ISR 8% / EGY 92%):

| Lado | Heurística | Política gulosa | **PUCT (48 sim.)** |
|------|-----------|-----------------|--------------------|
| Israel (atacante) | 8% | 17% | **33%** |
| Egito (defensor)  | **92%** | 67% | 67% |

A **busca quadruplica o atacante** (8→33%) e dobra a política gulosa (17→33%): a cabeça
de valor dá o horizonte estratégico que a política de 1 lance não tem (enxerga o payoff
de ponte→travessia→objetivos). O defensor, já perto do teto da heurística (92%), não
melhora (PUCT e guloso ambos 67%) — a busca não excede o avaliador, que é mais fraco que
a heurística na defesa. Um controle isola **o que** a busca usa: dirigir o PUCT com um
prior de política *mais forte* mas valor *pior calibrado* (o MLP de currículo 97%, cujo
crítico só viu jogo heurístico) **reduz** o atacante a 17%, abaixo dos 33% obtidos com o
modelo de self-play (política mais fraca, crítico melhor). **Em PUCT aqui o valor domina
o prior**: a qualidade da busca acompanha o avaliador, não o ator.

**Refino AlphaZero (assimetria instrutiva).** Fechamos o laço: o auto-jogo com PUCT gera
alvos `(π, z)` — π = distribuição de visitas da raiz (com ruído Dirichlet e temperatura)
e z = desfecho graduado — e re-treinamos política (entropia cruzada em π) e valor (EQM em
z), aquecidos dos modelos PPO. Três variantes controladas (10 *seeds* vs. heurística):

| Variante | Israel | Egito |
|----------|--------|-------|
| Baseline (PUCT, valor PPO) | 30% | 70% |
| AZ ingênuo (política + valor) | 0% | 60% |
| Só-valor, auto-jogo lopsided | 0% | **80%** |
| Só-valor, alvos balanceados | 10% | — |

O re-treino ingênuo **degrada** (a política colapsa rumo à π quase-uniforme de poucas
simulações). O modo **só-valor** (congela a política, re-ajusta só o valor) isola a
causa: o **defensor melhora (70→80%)**, pois seus desfechos são informativos, mas o
**atacante cai a 0%** — no auto-jogo dominado pelo defensor quase todo registro do ISR é
derrota (z<0), e o valor **perde poder de discriminação**. Com **alvos balanceados** (ISR
vs. heurística, ~42% de vitórias) o atacante recupera só parcialmente (0→10%, ainda abaixo
dos 30% do baseline PPO): alvos Monte-Carlo crus de 24 partidas são mais ruidosos que o
crítico PPO (treinado com bootstrap em milhares de partidas), e o atacante (linhas de
vitória estreitas) é sensível à variância do valor. Superar o valor PPO via AlphaZero
exigiria **dados em larga escala e alvos de valor bootstrap**, inviável a ~10 s por
partida buscada numa máquina. O pipeline (`rl/az_*`) é liberado pronto para escalar.

### 6.5 Revisitando o atacante CNN/GNN: capacidade, não viés indutivo

A §6.1 deixou em aberto *por que* só o MLP de alta capacidade domina o atacante. A
hipótese intuitiva é viés indutivo (a equivariância translacional não "aponta" a casa
exata da ponte nem objetivos nomeados). Uma ablação controlada **refuta** isso. O
currículo é de recompensa esparsa; adicionamos shaping baseado em potencial ao atacante
(`train.py --shaping`) e variamos a largura (`--width`):

| GNN, currículo com shaping | params | win% vs heur. |
|---|---|---|
| Estreito, entropia 0,02 | 6,7 k | **0% (todas as avaliações)** |
| Largo, entropia 0,02 | 47,7 k | **pico 33%**, instável |
| Largo, entropia 0,005 + lr menor | 47,7 k | **~15–21% sustentado** |

Shaping sozinho não destrava rede pequena (Φ≈0, termo inerte); um GNN **7× mais largo**
sob as mesmas condições **aprende a vencer** (pico 33%, à altura do MLP), enquanto o
estreito com shaping idêntico fica em 0% → **a alavanca é capacidade, não viés indutivo**.
O largo é instável (pica e esquece); baixar entropia/lr o faz comprometer-se e sustentar
~15–21%. Ou seja: **capacidade + estabilidade de otimização**, não representação.

### 6.6 Abstração temporal e um estrategista LLM: uma lei de hierarquia

O atacante é de horizonte longo (~90 microdecisões). Testamos **abstração temporal**: um
controlador de alto nível escolhe, por rodada, entre poucas **macro-ações** (quais
objetivos atacar); um executor de baixo nível as realiza. As macro-ações reusam o
mecanismo de *target-sets* da heurística (executor "de graça"); folhas avaliadas pela
cabeça de valor. Também um **estrategista LLM** (híbrido "LLM propõe, sim/valor
verificam"): o modelo recebe o tabuleiro em texto e devolve planos em JSON, **aterrados**
(casas ilegais descartadas) e selecionados pelo valor. E uma **hierarquia de verdade**:
LLM no topo, mas o executor passa a ser o micro-PUCT (§6.4), enviesado pelos alvos do
plano.

| atacante ISR (12 seeds) | win% vs heurística |
|---|---|
| heurística | 8% |
| política gulosa | 17% |
| macro fixo (executor heurístico) | 17% |
| planos LLM, GPT-5 (executor heurístico) | 17% |
| planos LLM, GPT-4o-mini (executor heurístico) | 25% |
| micro-PUCT (executor), 24 sims, sem macro | 25% |
| **hierarquia: plano GPT-4o + micro-PUCT, 24 sims** | 17% |
| **micro-PUCT puro, 48 sims** | **33%** |

Macro-ações sobre o executor *fraco* (heurística) dobram (8→17%) e os planos adaptativos
do LLM somam mais (→25%) — abstração temporal e estrategista melhor ajudam **quando o
executor é fraco**. Mas um gerador mais forte não ajuda (GPT-5 ≈ GPT-4o-mini, 1 jogo de
diferença) e a profundidade satura (macro prof. 2=3): o **executor heurístico é o teto**.
E, crucialmente, pôr o plano **sobre o executor forte** (PUCT) **não** ajuda: a sims
iguais o viés leva o PUCT de 25%→17% (1 jogo, ruído, mas sem ganho); o PUCT puro é o
melhor (33%). **Lei de hierarquia deste domínio: o valor da camada estratégica é inverso
à força do executor** — um plano grosseiro resgata um executor míope, mas distorce o prior
já consciente de valor de um buscador tático competente. **A IA mais forte do atacante
segue sendo o micro-PUCT puro.**

## 7. Revisita da avaliação

Uma auditoria posterior do protocolo de avaliação mudou três das conclusões acima. O
avaliador reconstruído joga partidas completas em paralelo, reporta intervalos de Wilson
a 95% e usa ao menos 300 partidas por condição (1000 na validação de agentes otimizados),
sempre em sementes não vistas no treino ou no ajuste.

### 7.1 Um oponente que mudou e amostras pequenas

O oponente heurístico não ficou fixo. O modo *expectimax* de pontuação dos combates foi
introduzido depois do treino dos currículos da §6.1 e virou o padrão dos dois lados.
Toda avaliação posterior enfrentou, portanto, outro defensor. Com a mesma política e o
mesmo harness, o MLP da Fase A cai de 86,7% [80,3–91,2] para 14,0% [9,3–20,5] quando só
a pontuação do defensor muda; heurística contra heurística cai de 29,7% para 15,3%
(n=300). Os 97% da §6.1 e os 8–33% das §6.4 e §6.6 referem-se, portanto, a oponentes
diferentes. Com 12 partidas, o intervalo de uma taxa perto de 25% é de cerca de ±25
pontos, e boa parte das diferenças das §6.4 e §6.6 vale apenas como hipótese.

### 7.2 Onde o atacante falha

A instrumentação de 300 partidas heurísticas mostra que o atacante instala a ponte em só
40% dos jogos, quase sempre
nas rodadas 5–6, e ela sobrevive até o fim em 10%. Em 68% dos jogos nenhuma unidade
israelense termina na margem oeste. A cláusula de atrito da vitória egípcia responde por
88% das vitórias do Egito, mas com a margem oeste vazia ela se reduz a uma falha de
travessia. Mudar a regra de baixas ou o avanço pós-combate não tem efeito mensurável
(17,0% em todas as variantes, n=400). Na busca, o lance que a heurística faria está no
top-6 da política em só 19% das decisões, o que parece explicar parte do platô do PUCT.

### 7.3 Re-treino, ajuste da heurística e candidatos da busca

Re-treinado contra o defensor atual (PPO aquecido da Fase A), o atacante sai de 14% para
86,8% [83,1–89,7] em 30 updates (n=400). Não há sinal de teto estrutural, embora o
treino seja instável e as vitórias sejam sobretudo marginais. Cruzando os modos de pontuação por
lado (n=600), o expectimax custa cerca de 7 pontos ao atacante e rende 12 a 13 ao
defensor, o que sugere uma configuração assimétrica.

O ajuste dos pesos pelo método da
entropia cruzada leva o atacante heurístico de 18,6% para 50,8% [47,7–53,9] e o defensor
heurístico, contra o atacante re-treinado, de 12,9% para 100% (1000 partidas de
validação). Nos dois lados a principal mudança é a mesma, uma atração menor por alvos
distantes. Por fim, incluir o lance heurístico entre os candidatos do PUCT eleva a busca
de 23,5% para 55,0% com o mesmo modelo (n=200). No defensor, ao contrário, o prior
heurístico deixa o atacante re-treinado subir de 3,3% para 41,7%, provavelmente porque
reimporta a doutrina que o atacante aprendeu a explorar.

### 7.4 Exploração mútua e Nash da população

Todo agente treinado contra um único oponente foi explorável. O atacante re-treinado
vence 89,7% contra a heurística, mas 3,3% contra a GNN da Fase A e nenhuma de 300
partidas contra uma GNN re-treinada contra ele. Por sua vez, o defensor heurístico que o
derrota em todas as partidas perde 63,3% para a heurística otimizada de Israel. 

O jogo é mais bem
resumido pelo equilíbrio de Nash de uma população de 8 atacantes e 6 defensores, após
uma iteração de PSRO. Nesse equilíbrio o atacante vence **17,0%**: Israel joga o PUCT com
candidatos em união (98%) e o Egito a GNN re-treinada (97%). A iteração de PSRO quase não
moveu esse valor (16,9% antes dela), e a melhor resposta do atacante por PPO colapsou.

## 8. Discussão e Limitações

A assimetria do jogo é, ao mesmo tempo, sua riqueza e seu desafio. Algumas lições da
primeira parte são comparações relativas dentro de um mesmo protocolo, e a auditoria não
as atinge diretamente. A arquitetura adequada depende do papel, o self-play ingênuo
colapsa o lado desfavorecido e o fracasso das redes pequenas como atacantes é de
capacidade, não de viés indutivo (§6.5). Outras não resistem. A saturação
da busca e a lei de hierarquia apoiam-se em comparações de 12 partidas contra um oponente
que nenhum agente havia enfrentado no treino, e ficam apenas como hipóteses.

A auditoria acrescenta três lições. O oponente faz parte do resultado: uma mudança na
pontuação da heurística levou uma política fixa de 87% a 14%, e um reajuste de pesos
levou um atacante forte a 0%. O que a busca pode considerar limita o seu alcance: um único
lance doutrinário entre os candidatos dobra o PUCT do atacante, enquanto no defensor o
prior heurístico parece reimportar uma doutrina já explorada. E o equilíbrio é
propriedade de uma população: o Nash, com o atacante perto de 17%, é provavelmente o
resumo mais informativo de um jogo assimétrico.

Limitações:

- A população é pequena (8 por 6) e o PSRO parou após uma iteração; o valor de
  equilíbrio pode mudar com novas iterações.
- As células com busca usam 40–60 partidas, com intervalos de cerca de ±13 pontos.
- O modelo de transição do PUCT fixa o oponente como heurística e resolve o acaso por
  uma amostra por aresta.
- O ajuste fino por PPO é instável, e os checkpoints são escolhidos por validação.
- O laço AlphaZero é demonstrado, mas não escalado.

## 9. Conclusão

O estudo documentou um sistema de RL ponta a ponta sobre um wargame histórico
assimétrico, do motor de regras à inferência no navegador, e depois auditou a própria
avaliação. A auditoria inverteu a principal conclusão negativa: o atacante não estava
limitado a um terço das partidas, mas nós o avaliávamos contra um defensor que ele não
havia enfrentado, em amostras pequenas demais para distinguir as diferenças relatadas.
Re-treino, ajuste da heurística e ampliação dos candidatos da busca melhoram muito o
atacante contra um oponente fixo. Nenhum desses ganhos é robusto, porém: todo agente
treinado contra um único oponente perde para alguma contra-estratégia. O objeto adequado
de estudo parece ser, então, a população e o seu equilíbrio, no qual o defensor mantém a
vantagem e o atacante vence cerca de 17% das partidas. O artefato liberado inclui a arena
de avaliação, o otimizador e as matrizes da população necessários para reproduzir esses
resultados.

## Reprodutibilidade

Código, ambiente, treinador e modelos em `web/` (jogo) e `rl/` (RL). Comandos em
`rl/RL.md`; explicação visual em `rl/explicacao.html`; testes de motor
(`tests/`), conformidade às regras e paridade de inferência (`rl/test-parity.mjs`).
Sementes fixas garantem partidas reproduzíveis.

## Referências (indicativas)

- R. S. Sutton, A. G. Barto. *Reinforcement Learning: An Introduction.* 2ª ed.
- J. Schulman et al. *Proximal Policy Optimization Algorithms.* 2017.
- A. Y. Ng, D. Harada, S. Russell. *Policy Invariance under Reward Transformations:
  Theory and Application to Reward Shaping.* ICML 1999.
- D. Silver et al. *A general reinforcement learning algorithm that masters chess,
  shogi, and Go through self-play.* Science, 2018.
- M. Lanctot et al. *A Unified Game-Theoretic Approach to Multiagent Reinforcement
  Learning.* NeurIPS 2017.
- J. Schulman et al. *High-Dimensional Continuous Control Using Generalized Advantage
  Estimation.* ICLR 2016.

*Nota: lista de referências indicativa do arcabouço metodológico; não substitui
levantamento bibliográfico formal para submissão.*
