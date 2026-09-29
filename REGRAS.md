# A Guerra do Yom Kippur — Regras do Jogo

Referência completa das regras, consolidada a partir da documentação original do
wargame (livreto de regras, tabelas de combate, manifesto de peças e tabuleiro nº 4,
digitalizados em [`files/`](files/)). A redação foi reorganizada e resumida para
consulta; a numeração entre parênteses remete aos itens do Referencial de Regras
original. As poucas adaptações da versão digital estão marcadas com **[digital]**.

---

## 1. Contexto histórico

Em outubro de 1973, uma ofensiva egípcia cruzou o Canal de Suez e rompeu a Linha
Bar-Lev. A resposta israelense culminou numa contraofensiva audaciosa: uma
força-tarefa cruzou o canal perto de Deversoir, estabeleceu uma cabeça-de-ponte na
margem oeste e ameaçou isolar o Terceiro Exército Egípcio antes do cessar-fogo
imposto pela ONU. O jogo simula essa operação: o General Israelense tenta cumprir
seus objetivos em **6 rodadas**; o General Egípcio tenta impedi-lo.

## 2. Material

- Tabuleiro nº 4: grade de hexágonos ("casas") numerados `CCRR` (coluna 01–25,
  linha 01–22), cobrindo o trecho do Canal de Suez entre Ismaília e Faíd;
- 45 peças militares: 24 egípcias (rosa) e 21 israelenses (azuis);
- 2 tabelas de combate (Relação de Forças e Efeitos de Combate) e 2 tabelas de
  terreno (movimentação e defesa);
- 2 dados comuns; 6 botões (marcador de rodadas e marcadores de artilharia usada).

## 3. As peças

Cada peça representa um batalhão ou regimento ("unidade") e traz:

- **Silhueta** do tipo de tropa: transportes blindados (infantaria mecanizada),
  infantaria, tanques, artilharia, artilharia automotiva, SAM (míssil
  antiaéreo), engenharia (símbolo de ponte) e foguetes terra-terra;
- **Índice de Combate (IC)**: força de ataque/defesa;
- **Índice de Mobilidade (IM)**: pontos de movimento por fase;
- **Alcance de Fogo** (apenas artilharia/foguetes): número impresso acima da
  silhueta, em casas.

As peças têm **frente e verso**: a frente (silhueta preta) é a unidade intacta; o
verso (silhueta clara) é a unidade **com baixas**, com IC e IM reduzidos.

### Valores das unidades (intacta → com baixas)

| Unidade | Lado | IC-IM intacta | IC-IM com baixas | Alcance |
|---|---|---|---|---|
| Infantaria | Egito | 2-15 | 1-8 | — |
| Transportes blindados | ambos | 2-20 | 1-10 | — |
| Tanques | Egito | 3-20 | 1-10 | — |
| Tanques pesados | Egito | 5-20 | 2-10 | — |
| Tanques | Israel | 4-20 | 2-10 | — |
| Artilharia | Egito | 3-15 | 1-8 | 8 |
| Foguetes terra-terra | Egito | 3-15 | 1-8 | 4 |
| Artilharia automotiva (longo alcance) | Israel | 2-20 | 1-10 | 12 |
| Artilharia automotiva (médio alcance) | Israel | 2-20 | 1-10 | 8 |
| Engenharia | Israel | 2-15 | 1-8 | — |
| Base SAM | Egito | — (fixa, sem combate) | — | — |

## 4. O tabuleiro

### 4.1 Tipos de terreno

| Terreno | Custo de movimento (por casa) | Bônus defensivo |
|---|---|---|
| Estrada | 1 | anula os demais fatores de terreno |
| Cidade | 1 | +1 |
| Firme e aberto | 2 | nenhum |
| Dunas | 3 | +2 |
| Bosque | 3 | +2 |
| Acidentado | 4 | +2 |
| Canal de água doce | +3 por travessia (grátis nas pontes) | nenhum |
| Lagos (casas azuis) | proibido entrar | — |

O canal de água doce corre **entre os hexágonos** (é uma feature de aresta):
mover-se entre duas casas separadas pela linha verde custa +3 pontos, salvo
quando a travessia se dá por uma aresta de estrada (ponte).

### 4.2 O Canal de Suez

- **Nenhuma unidade pode cruzar o Canal de Suez**, exceto pelas pontes (2.2.14):
  - **Ponte de Ismaília** (entre as casas 1202 e 1303): única travessia egípcia;
    israelenses também podem usá-la;
  - **Ponte de engenharia israelense** (ver §9): apenas israelenses.
- O canal contorna Ismaília pelo sudeste e atravessa o **Lago Tinsah** e o
  **Grande Lago Amargo**. As casas 1203–1207 (leste do lago Tinsah) pertencem à
  margem do Sinai.
- As **zonas de engajamento atravessam o canal** (3.3): unidades em casas
  adjacentes ficam engajadas mesmo com o canal entre elas.
- É proibido entrar nas casas de lago (2.2.24). Uma estrada com ponte local cruza
  o braço d'água ao sul do Tinsah (casas 1107–1108–1208).

### 4.3 Casas de entrada e saída

- Estradas saem do mapa para **Cairo** (oeste, casa 0114) e **Jerusalém** (leste,
  casa 2505).
- Entradas israelenses: **2505** e **1922** (engenharia e reforços: somente 2505).
- Entradas egípcias (reforços): **1201**, **0621** e **0722**.

## 5. Posição inicial (5.1–5.4)

### Egito (no tabuleiro desde o início)

| Unidade | Casas |
|---|---|
| 6 × Infantaria (2-15) | 0803, 2101, 2103, 1905, 1615, 0722 |
| 2 × Transportes blindados (2-20) | 1512, 1311 |
| 2 × Foguetes terra-terra (4 / 3-15) | 1802, 1604 |
| 1 × Artilharia (8 / 3-15) | 1304 |
| 1 × Tanques (3-20) | 1502 |
| 3 × Bases SAM (fixas) | 0211, 0216, 0121 |

### Israel (entra a partir da rodada 1, pelas casas 2505 ou 1922)

7 × tanques (4-20), 3 × transportes blindados (2-20), 1 × engenharia (2-15),
1 × artilharia automotiva de longo alcance (12 / 2-20) e 1 × de médio alcance
(8 / 2-20). A engenharia só pode entrar pela casa 2505.

### Entrada em fila (2.2.10–2.2.12, 6.7–6.10)

As unidades entram como se a fila fosse uma extensão da estrada: na mesma fase, a
1ª unidade a entrar por uma casa paga 1 ponto de movimento, a 2ª paga 2, a 3ª
paga 3, e assim por diante (contagem independente por casa de entrada). Não se
pode entrar por casa ocupada; entrando em zona de engajamento inimiga, a unidade
para imediatamente e fica engajada. A entrada pode ser adiada para rodadas
seguintes.

## 6. Sequência de jogo (1.1–1.3)

A partida tem **6 rodadas**, cada uma com **8 fases**:

| Fase | Quem | O quê |
|---|---|---|
| 1 | Israel | Movimentação (inclusive entradas e reforços) |
| 2 | Israel | Designação dos ataques e da artilharia de barragem |
| 3 | Egito | Designação da artilharia de cobertura (defensiva) |
| 4 | — | Resolução dos combates israelenses |
| 5–8 | Egito/Israel | Os mesmos procedimentos com os papéis invertidos |

O marcador de rodadas avança ao fim da fase 8. A partida termina ao fim da
rodada 6 (ou antes, por acordo/rendição — **[digital]** não implementado).

## 7. Movimentação (2.x)

- Cada unidade pode mover-se **uma vez por fase de movimentação própria**, quantas
  casas quiser, pagando o "pedágio" do terreno da casa **de destino** de cada
  passo, até o limite do seu IM (2.2.3–2.2.6). O terreno da casa de origem não
  influi.
- O deslocamento é por casas vizinhas, em linha reta ou não (2.2.2).
- Unidades **amigas podem ser atravessadas**, mas duas unidades jamais ocupam a
  mesma casa (2.2.13, 2.2.23 análogo).
- Vale a norma "peça tocada, casa jogada" (2.2.20) — no original e na versão
  digital, o movimento confirmado é definitivo.
- **As SAMs não se movimentam** (2.2.21).
- Unidade que sai do tabuleiro é considerada destruída (2.2.22) — só é possível
  pela escolha do jogador, e não há retorno.
- Toda unidade **deve parar** ao entrar na zona de engajamento de uma unidade
  inimiga (2.2.18).

## 8. Zonas de engajamento (3.x)

- A **zona de engajamento** de uma unidade são as **6 casas vizinhas** à casa que
  ela ocupa. SAMs não possuem zona de engajamento (3.1).
- Quando uma unidade entra na zona de engajamento inimiga, **ambas ficam
  engajadas**: nenhuma das duas pode mover-se, exceto por efeito de combate
  (recuo ou avanço) (3.2).
- As zonas atravessam qualquer terreno **e o próprio Canal de Suez** (3.3).
- Zona de engajamento de unidade amiga não impede nada; a simples interseção de
  zonas não tem efeito (3.4).

## 9. A ponte de engenharia israelense (4.3, 2.2.15–2.2.17)

- A ponte considera-se **instalada** quando o batalhão de engenharia ocupa uma
  casa da **margem leste adjacente ao Canal de Suez**, no trecho entre o Grande
  Lago Amargo e o Lago Tinsah, **e que não seja adjacente aos lagos**.
- A ponte liga a casa da engenharia às casas adjacentes da margem oposta.
  **A passagem pela ponte custa 1 ponto** de movimento; nenhuma unidade pode
  estacionar na casa da ponte (a casa está ocupada pela engenharia).
- A engenharia não pode cruzar o canal (2.2.17). Se mover-se, recuar ou for
  eliminada, **a ponte deixa de existir**.
- Engenharia eliminada **pode retornar ao jogo** na fase de movimentação da rodada
  seguinte, entrando novamente pela casa 2505 como reforço (4.3.2).

## 10. Combate (4.x)

### 10.1 Obrigatoriedade e organização dos ataques

- Infantaria, tanques e transportes blindados **devem atacar** as unidades
  inimigas com as quais estejam engajados (4.1.1).
- Ao fim da fase de combate do atacante, **todas** as suas unidades engajadas
  precisam ter atacado e **todas** as unidades engajadas do defensor precisam ter
  sido atacadas (4.1.3).
- Uma unidade adjacente a várias inimigas **pode (e deve) atacá-las todas num só
  combate** (4.1.5); nenhuma unidade ataca ou é atacada duas vezes na mesma fase
  (4.1.6). Vários atacantes adjacentes ao mesmo defensor somam seus IC num único
  combate (4.1.4). Na prática, cada grupo de unidades mutuamente adjacentes
  resolve **um único combate combinado**.

### 10.2 Artilharia e foguetes (4.2)

- Podem combater de três formas: (a) como unidade normal contra inimigos
  adjacentes; (b) **fogo de barragem**, somando seu IC ao ataque de unidades
  amigas contra uma casa dentro do alcance; (c) **fogo de cobertura**, somando seu
  IC à defesa de unidades amigas atacadas dentro do alcance.
- O **alcance** conta-se a partir da casa vizinha à artilharia (inclusive a casa
  do alvo, exclusive a própria) (4.2.5).
- Artilharia **engajada** combate como unidade comum e não pode dar barragem nem
  cobertura (4.2.4). Artilharia **não pode atacar sozinha à distância** (4.2.6).
- Cada artilharia atua **uma única vez por rodada**, seja na barragem, seja na
  cobertura (4.2.7) — os botões marcam as que já atiraram.
- A artilharia que apoia à distância **nunca sofre os efeitos** do combate
  (recuo, baixas, eliminação) (4.2.3); o terreno só influi no seu IC quando ela
  combate adjacente (4.5.10).

### 10.3 Cálculo do combate (4.5.1–4.5.3)

1. O atacante declara os combates e a barragem; o defensor declara a cobertura.
2. **Total do atacante** = soma dos IC das unidades atacantes + barragens.
3. **Total do defensor** = soma dos IC das unidades atacadas, cada uma acrescida
   do bônus de terreno da sua casa (estrada anula o bônus), + coberturas.
4. A razão entre os totais define a **coluna** da Tabela de Efeitos:

| Relação ataque : defesa | Coluna |
|---|---|
| igual ou inferior à metade (A×2 ≤ D) | −2 |
| inferior (A < D) | −1 |
| igual ou superior, mas inferior ao dobro (D ≤ A < 2D) | = |
| dobro ou mais, mas menos do triplo (2D ≤ A < 3D) | +1 |
| triplo ou mais (A ≥ 3D) | +2 |

5. O atacante lança **2 dados** e consulta a coluna.

### 10.4 Tabela de Efeitos de Combate (2d6)

Cada resultado combina o efeito sobre o **D**efensor e sobre o **A**tacante:

| Dados | −2 | −1 | = | +1 | +2 |
|---|---|---|---|---|---|
| 2 | DVI-AE | DVI-AE | DE-AVI | DE-AVI | DE-AVI |
| 3 | DVI-AE | DVB-AE | DE-AVB | DE-AVB | DE-AVI |
| 4 | DVB-AE | DVB-AE | DVI-ARI | DE-AVB | DE-AVB |
| 5 | DVI-AE | DVB-ARB | DRB-AVB | DRB-AVB | DE-AVI |
| 6 | DVB-ARB | DVB-ARI | DVB-ARI | DRI-AVB | DRB-AVB |
| 7 | DVI-ARB | DVB-ARB | DRI-AVI | DRB-AVB | DRB-AVI |
| 8 | DVI-ARI | DVB-ARI | DRI-AVB | DRI-AVB | DRI-AVI |
| 9 | DVI-ARB | DRB-AVB | DVB-ARB | DVB-ARB | DRB-AVI |
| 10 | DRI-AVB | DRI-AVB | DVI-ARI | DVB-ARI | DVB-ARI |
| 11 | DRI-AVB | DRB-AVB | DVB-AE | DVB-ARB | DVB-ARI |
| 12 | DRB-AVB | DE-AVB | DVI-AE | DVB-AE | DVB-ARB |

**Legenda** (4.5.7): AE = atacante eliminado · ARB = atacante recua com baixas ·
ARI = atacante recua intacto · AVB = atacante vence com baixas · AVI = atacante
vence intacto · DE = defensor eliminado · DRB = defensor recua com baixas ·
DRI = defensor recua intacto · DVB = defensor vence com baixas · DVI = defensor
vence intacto.

### 10.5 Aplicação dos efeitos (4.5.5–4.5.7)

Os efeitos aplicam-se imediatamente, **sempre primeiro sobre o defensor** (4.5.6):

- **DE**: uma unidade defensora (à escolha do defensor) é retirada do jogo; as
  demais recuam uma casa. O atacante pode ocupar as casas que vagarem.
- **DRB / DRI**: todas as defensoras recuam uma casa, saindo da zona de
  engajamento dos atacantes; em DRB, uma delas (escolha do defensor) sofre baixas.
- **DVB / DVI**: o defensor mantém posição; em DVB uma defensora sofre baixas.
- **AE**: uma unidade atacante (à escolha do atacante) é eliminada; as demais
  recuam uma casa.
- **ARB / ARI**: todas as atacantes recuam uma casa; em ARB uma sofre baixas.
- **AVB / AVI**: vitória do atacante; em AVB uma atacante sofre baixas. Qualquer
  unidade que participou do ataque **pode avançar** para a casa desocupada — esse
  avanço não é impedido por zonas de engajamento.

### 10.6 Baixas (4.4, 4.5.9)

- A unidade que sofre baixas **vira o verso** (IC e IM reduzidos).
- **Reincidência**: a segunda baixa elimina a unidade, mesmo que a inimiga que a
  combatia também tenha sido eliminada.
- Ao escolher quem sofre a baixa, a escolha **deve recair primeiro** sobre
  unidades que já tenham baixas (que são então eliminadas); se nenhuma tiver, a
  escolha é livre. Os efeitos de baixa/recuo atingem só as unidades envolvidas no
  combate (exposição a baixas, 4.x).

### 10.7 Recuos (4.5.8, 6.x do livreto de instruções)

- O recuo é de **uma casa**, em qualquer direção que **saia da zona de
  engajamento** da unidade inimiga combatida.
- A unidade forçada a recuar é **eliminada** se todas as casas adjacentes
  estiverem ocupadas por inimigos ou em zonas de engajamento inimigas, ou
  bloqueadas pelo Canal de Suez/lagos ("recuo impossível").
- Se a única casa de recuo estiver ocupada por **unidade amiga**, esta pode ser
  **deslocada em cadeia** para abrir caminho — deslocamentos sucessivos são
  permitidos quando forem o único modo de viabilizar o recuo.
- **Recuo israelense pelo canal**: só pelas pontes. Recuando pela ponte de
  engenharia, a unidade recua **duas casas** (atravessa a casa da ponte e ocupa
  uma casa adjacente na outra margem) — único caso de recuo de duas casas. Se a
  própria engenharia for forçada a recuar, é eliminada (não pode cruzar o canal).

### 10.8 Bases SAM

- Não se movem, não têm zona de engajamento, não combatem.
- São **eliminadas** quando uma unidade israelense **ocupa ou atravessa** a sua
  casa.
- Consideram-se **capturadas** se, **ao fim do jogo**, houver unidade israelense
  mais próxima delas do que qualquer unidade egípcia (7.2).

## 11. Reforços (6.x)

### Israel (6.1–6.4)

- Recebe **3 batalhões de tanques (4-20)** e **3 de transportes blindados (2-20)**
  na **primeira rodada seguinte** àquela em que a engenharia instalar a ponte.
- Entram **somente pela casa 2505** (estrada de Jerusalém), e somente enquanto a
  ponte estiver de pé (6.2): destruída a ponte antes da entrada, os reforços
  aguardam a reconstrução.

### Egito (6.5–6.6)

| Rodada | Reforços |
|---|---|
| 3ª | 1 transporte blindado (2-20) + 1 bateria de foguetes (4 / 3-15) |
| 4ª | 1 transporte blindado (2-20) + 1 tanque pesado (5-20) + 2 artilharias (8 / 3-15) |
| 5ª | 1 transporte blindado (2-20) + 2 tanques pesados (5-20) |

Entram por **1201, 0621 ou 0722**, à escolha. Reforços que não entrarem
acumulam-se e podem entrar em qualquer rodada seguinte (6.7–6.11; pagam o pedágio
em fila normal; casas de entrada bloqueadas por inimigos obrigam a usar outra).

## 12. Condições de vitória (7.x)

### Objetivos israelenses (7.1)

1. **Destruir ou capturar todas as bases SAM** egípcias;
2. **Controlar as duas entradas de Ismaília** (casas 0803 e 1202);
3. **Controlar uma das entradas de Fahid** (casas 0621 ou 0722).

"Ocupar ou controlar" = ter unidade na casa, ou ser o único lado com unidades
adjacentes a ela.

### Tabela de resultados

| Resultado | Condição |
|---|---|
| **Vitória decisiva israelense** | os três objetivos cumpridos |
| **Vitória parcial israelense** | exatamente dois objetivos (7.3) |
| **Vitória marginal israelense** | exatamente um objetivo (7.4) |
| **Vitória decisiva egípcia** | impediu a vitória decisiva israelense **e** Israel perdeu mais unidades do que mantém na margem oeste ao fim do jogo (7.5) |
| **Vitória parcial egípcia** | Israel não cumpriu objetivo algum **e** uma das estradas que ligam Fahid a Ismaília está desimpedida ao fim do jogo (7.6) |
| **Vitória marginal egípcia** | Israel não cumpriu objetivo algum (7.7) |

A avaliação é feita ao fim da 6ª rodada. **[digital]** Ordem de precedência
aplicada: decisiva israelense → decisiva egípcia → parcial israelense → parcial
egípcia → marginal israelense → marginal egípcia.

## 13. Tabela-resumo das quatro tabelas (consulta na partida)

1. **Influência do Terreno na Movimentação** — custos do §4.1;
2. **Influência do Terreno como Fator Defensivo** — bônus do §4.1;
3. **Relação de Forças** — colunas do §10.3;
4. **Efeitos de Combate** — matriz 2d6 do §10.4.

Consultam-se nessa ordem durante a partida: mover → comparar forças → rolar os
dados → aplicar efeitos.

---

*Recomenda-se aos novos jogadores jogar as primeiras partidas consultando apenas
as seções 6–10 e usando o restante como material de referência — o espírito do
livreto original, que separa as "Instruções de Jogo" didáticas do "Referencial de
Regras" detalhado.*
