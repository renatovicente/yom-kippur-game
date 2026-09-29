# A IA do jogo — como funciona

Este documento explica em detalhe a inteligência artificial de **A Guerra do Yom
Kippur** ([`web/js/ai.js`](web/js/ai.js), com as escolhas de combate em
[`web/js/game.js`](web/js/game.js) — `decisorAuto`). A IA joga **qualquer um dos
lados** (e os dois ao mesmo tempo no modo IA×IA) usando o mesmo motor de regras
que o jogador humano — ela não vê nada além do estado público do tabuleiro e não
recebe nenhum bônus.

## 1. Visão geral: uma IA heurística gulosa

A IA é **heurística e míope (1 jogada de profundidade)**: não há árvore de busca,
minimax nem aprendizado. Em cada fase ela avalia as opções imediatas com uma
**função de pontuação** e executa a melhor. Essa escolha de projeto tem três
razões:

1. **Velocidade** — cada fase é decidida em milissegundos, mesmo no navegador;
2. **Legibilidade** — cada peso da pontuação corresponde a um princípio tático
   declarado (e ajustável);
3. **Adequação ao jogo** — o wargame tem combates obrigatórios e ZOCs rígidas;
   a maior parte da "inteligência" está em *onde parar*, e isso uma função de
   pontuação local captura bem.

O comportamento de nível estratégico (defender Ismaília, escoltar a engenharia,
caçar a ponte) **emerge das listas de alvos**, não de um planejador.

A IA é **determinística para uma mesma semente**: toda a aleatoriedade da partida
vem dos dados de combate (RNG semeado), nunca das decisões da IA.

## 2. O despachante de fases — `jogarFase`

Cada fase da rodada tem um tratador:

| Fase | Função | O que faz |
|---|---|---|
| Movimentação | `moverIA` | entradas de reforços + movimento de cada unidade |
| Designação de ataques | `prepararAtaques` + `alocarBarragens` | os combates são obrigatórios (componentes conexos do grafo de engajamento — regra 4.1.5), então a única decisão é a artilharia de barragem |
| Cobertura defensiva | `alocarCobertura` | aloca artilharia de cobertura aos combates mais perigosos |
| Resolução | `decisorAuto` | escolhas exigidas pelas regras: quem sofre baixas, quem é eliminada, para onde recuar, se avança |

## 3. Fase de movimentação — `moverIA`

### 3.1 Ordem de processamento

As unidades movem **uma a uma, em ordem de papel tático**:

```
engenharia → tanques (e pesados) → transportes → infantaria → artilharia/foguetes
```

A engenharia move primeiro porque o resto da força israelense se posiciona em
função dela; a artilharia move por último para se ajustar à linha de frente já
formada. Como o processo é sequencial e guloso, cada unidade já "vê" as posições
finais das que moveram antes — uma forma barata de coordenação.

### 3.2 Entradas de reforços

Antes dos movimentos, a IA processa o pool de unidades fora do tabuleiro
(`poolEntrada`): para cada uma, escolhe a **casa de entrada mais próxima dos seus
alvos** (respeitando as restrições — engenharia e reforços israelenses só pela
2505) e, se sobrar mobilidade após o pedágio da fila, a unidade continua movendo
no mesmo passo.

### 3.3 Os alvos de cada unidade — `alvosDe`

É aqui que mora a "doutrina" de cada lado.

**Israel:**

1. **Engenharia** — alvo é a melhor casa elegível para a ponte (margem leste,
   colunas 13, linhas 8–16, livre, válida pela regra 2.2.15). Entre as
   candidatas, prefere a **mais distante das unidades egípcias** (instalar a
   ponte onde o inimigo demora a chegar). Se já está numa casa elegível, o alvo é
   **ficar parada** — mover desfaria a ponte.
2. **Artilharia** — alvo são as posições inimigas (a pontuação a manterá a
   distância ideal, ver §3.5).
3. **Resgate** — se a engenharia está engajada (o Egito adora "pregá-la" no
   lugar), os alvos de todas as unidades de manobra passam a ser **as casas dos
   inimigos adjacentes à engenharia**: a força converge para libertá-la.
4. **Antes da ponte** — as unidades de manobra escoltam a engenharia (alvo = a
   casa-objetivo da engenharia e a própria engenharia).
5. **Depois da ponte** — os alvos viram os **objetivos de vitória ainda não
   controlados**: 0803, 1202 (Ismaília), 0621, 0722 (Fahid) e as casas das SAMs
   vivas (0211, 0216, 0121).

**Egito:**

1. **Caça à ponte** — se a engenharia israelense está numa casa elegível com a
   ponte de pé, ela vira **o alvo único de todo o exército**: eliminar a
   engenharia desfaz a ponte e corta os reforços israelenses.
2. **Guarnição** — uma unidade que já ocupa um objetivo de defesa (entradas de
   Ismaília e Fahid, casas das SAMs) tem como alvo **a própria casa**: guarnições
   não abandonam seus postos.
3. **Defesa e contenção** — as demais unidades têm como alvos todos os objetivos
   de defesa e as posições israelenses; cada uma vai ao alvo mais próximo, o que
   distribui o exército entre guarnecer objetivos e conter o avanço inimigo (em
   vez de migrar em massa para um único ponto).

### 3.4 A escolha do destino — `moverUnidade`

Para cada unidade, a IA:

1. calcula **todas as casas alcançáveis** com `alcance` (o mesmo Dijkstra usado
   pelo humano — custos de terreno, paradas por ZOC, pontes, tudo conforme as
   regras);
2. pontua cada destino com `pontuar` (incluindo **ficar parada**, que ganha +1 de
   inércia para evitar dança sem propósito);
3. desempata destinos de pontuação igual pelo **menor custo de movimento**
   (−0,01/ponto);
4. executa o melhor movimento.

### 3.5 A função de pontuação — `pontuar`

A pontuação de um destino `h` para a unidade `u` soma os seguintes termos:

| Termo | Valor | Princípio tático |
|---|---|---|
| Progresso | `−10 × dist(h, alvo mais próximo)` | aproximar-se do objetivo é o motor básico |
| Ocupar um alvo | `+80` | sentar em cima do objetivo vale mais do que qualquer outra coisa |
| Engajar com coluna +2 | `+70` | ataque com tripla superioridade: sem risco de eliminação na CRT |
| Engajar com coluna +1 | `+35` | bom ataque, risco moderado |
| Engajar com coluna = | `−25` | a coluna "=" elimina o atacante nos dados 11–12: evita |
| Engajar com coluna −1/−2 | `−100` | ataque suicida (o combate seria **obrigatório** na própria fase) |
| Artilharia/engenharia engajando | `−80` | unidades de apoio não devem trocar tiros |
| Posição de artilharia | `−6 × \|dist − (alcance−1)\|` | ficar a (alcance−1) do inimigo mais próximo: cobre a frente e não é alcançada |
| Exposição | `−30` se IC inimigo num raio de 3 > 2× (IC amigo + próprio) | não terminar o turno isolado no meio do exército adversário |
| Terreno | `+2 × bônus defensivo` | preferência leve por dunas/bosque/cidade |
| Inércia | `+1` por ficar parada | estabilidade |

O ponto mais importante: **como os combates são obrigatórios**, terminar o
movimento adjacente a um inimigo significa *comprometer-se a atacá-lo* na fase
seguinte. Por isso o termo de engajamento domina a pontuação — a IA só aceita
engajar quando a matemática da CRT é favorável.

### 3.6 A estimativa de odds — `estimarColuna`

Antes de aceitar um engajamento, a IA simula o combate resultante:

1. identifica os inimigos que ficariam adjacentes ao destino;
2. soma ao seu próprio IC o IC de **todas as unidades amigas já adjacentes** a
   esses inimigos (porque a regra 4.1.5 as fundirá num único combate combinado);
3. soma ao IC dos defensores o **bônus de terreno** das casas deles;
4. converte a razão na coluna da Tabela de Relação de Forças (−2 … +2).

A estimativa é conservadora: ignora barragens futuras (próprias e inimigas) e
considera apenas amigos *já posicionados* — unidades que ainda vão mover no mesmo
turno não contam. Na prática isso gera um padrão de "primeiro tanque ancora,
segundo tanque junta-se" ao longo de dois turnos.

## 4. Fase de ataque — `alocarBarragens`

Os combates em si são determinados pelas regras (componentes conexos). A IA só
decide **a artilharia**:

- Para cada combate, percorre as artilharias disponíveis (no alcance, não
  engajadas, sem ter atuado na rodada — regra 4.2.7);
- adiciona uma bateria à barragem **somente se ela melhorar a coluna** da Tabela
  de Relação de Forças (somar IC sem mudar coluna seria desperdiçar o único tiro
  da rodada);
- para de adicionar ao atingir a coluna **+2** (teto da tabela).

## 5. Fase de cobertura — `alocarCobertura`

Espelho defensivo da barragem, com triagem:

- os combates são ordenados **do pior para o defensor ao melhor** (coluna do
  atacante decrescente);
- para cada um, adiciona artilharia de cobertura **se a coluna do atacante cair**
  com o IC somado à defesa;
- ignora combates que já estão em coluna **−1 ou melhor** para o defensor — o
  tiro da rodada é guardado para onde faz diferença.

## 6. Resolução — as escolhas do `decisorAuto`

Quando os dados exigem decisões, a IA usa heurísticas simples:

| Decisão | Heurística |
|---|---|
| Quem sofre baixas | a unidade de **menor valor** (`IC atual − 10 se já tem baixas`) — respeitando a regra 4.5.9, que obriga a escolher primeiro quem já tem baixas |
| Quem é eliminada (AE/DE) | idem: sacrifica a mais fraca/ferida |
| Para onde recuar | heurística do motor (`melhorRecuo`): a casa que **maximiza a distância do inimigo mais próximo** (+10/casa), com desempate por terreno defensivo e penalidade para casas ocupadas (que exigiriam deslocamento em cadeia) |
| Avançar após vitória | avança a unidade de **maior IC** para a casa vaga de **melhor terreno** (consolida a conquista com a peça mais forte) |

## 7. Comportamentos emergentes observados

Nenhum destes está programado explicitamente — todos emergem da pontuação:

- **O Egito "prega" a engenharia**: engajar a engenharia (IC 2) é um dos poucos
  engajamentos com coluna aceitável para a infantaria egípcia, e a engenharia
  engajada não pode mover — o avanço israelense trava até o resgate;
- **Comboio de escolta**: como os tanques israelenses têm a engenharia como alvo
  antes da ponte, eles formam naturalmente uma bolha em volta dela;
- **Mudança de fase estratégica**: instalada a ponte, os alvos israelenses trocam
  em massa para a margem oeste, e os egípcios convergem para a casa da ponte —
  o jogo "vira" como na batalha histórica;
- **Artilharia a reboque**: as baterias seguem a frente a (alcance−1) casas,
  recuando quando a linha recua.

Nas partidas IA×IA de teste (8 sementes), a ponte é instalada por volta da
rodada 5 e os resultados se distribuem entre vitórias egípcias (decisivas e
parciais) e israelenses (marginais) — coerente com o desenho assimétrico do jogo
original, que favorece o defensor.

## 8. Limitações conhecidas

- **Horizonte de 1 jogada**: a IA não planeja "engajar aqui para abrir caminho
  ali na próxima rodada"; sem sacrifícios posicionais deliberados;
- **Coordenação implícita, não planejada**: o ataque combinado depende da ordem
  sequencial; a IA não calcula "se estas 3 unidades moverem juntas, a coluna será
  +2" antes de mover a primeira;
- **Sem modelo do adversário**: não antecipa barragens nem reforços inimigos;
- **Recuo sem previsão**: `melhorRecuo` não considera se a casa de recuo será
  alvo fácil na rodada seguinte;
- **Pesos fixos**: os valores do §3.5 foram calibrados manualmente nas partidas
  de teste; não há ajuste dinâmico por fase da partida.

## 9. Onde mexer para ajustar a dificuldade

Todos os pesos estão em `pontuar` ([`ai.js`](web/js/ai.js)). Sugestões de
experimento:

| Efeito desejado | Ajuste |
|---|---|
| IA mais agressiva | reduzir a penalidade da coluna "=" (−25 → −5) e da exposição |
| IA mais cautelosa | aumentar a penalidade de exposição (−30 → −60) e o raio de 3 → 4 |
| Israel mais rápido na ponte | aumentar o peso de progresso da engenharia (fator 10 → 14 só para `eng`) |
| Egito mais defensivo | em `alvosDe`, manter sempre 2–3 unidades nos objetivos mesmo com a ponte de pé |
| IA menos previsível | somar um ruído pequeno (±2) à pontuação usando o RNG semeado da partida |

Uma evolução natural seria substituir o movimento guloso por uma busca de feixe
(beam search) de 2 jogadas só para as 5 unidades mais relevantes — o custo
computacional seguiria desprezível e resolveria a principal fraqueza (§8, item 2).
