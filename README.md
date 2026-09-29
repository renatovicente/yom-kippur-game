# A Guerra do Yom Kippur — versão digital

Adaptação digital totalmente jogável do wargame de tabuleiro **A Guerra do Yom Kippur**
(Wargame II), que simula a travessia israelense do Canal de Suez em outubro de 1973.
O tabuleiro, as peças, as tabelas de combate e as regras foram reconstruídos a partir
da documentação original digitalizada na pasta [`files/`](files/).

## Modos de jogo

- **Humano × Humano** — dois jogadores no mesmo computador (hotseat)
- **Humano × IA** — jogue como Israel ou como Egito contra a IA
- **IA × IA** — assista a uma partida automática

## Como rodar localmente

Requisito: Python 3 (já presente no macOS/Linux) — usado só como servidor de arquivos.

```bash
./run-local.sh            # abre http://localhost:8080
./run-local.sh 9000       # porta alternativa
```

Alternativa sem script: abra `web/index.html` diretamente no navegador
(o jogo é 100% estático, sem dependências externas).

## Como implantar na AWS

A implantação usa **S3 (bucket privado) + CloudFront (OAC)** via CloudFormation.

```bash
# autentique-se antes (ex.: aws sso login --profile meu-profile)
cd deploy/aws
AWS_PROFILE=meu-profile ./deploy.sh
```

O script:
1. cria/atualiza a stack `yom-kippur-game` (bucket S3 privado, distribuição CloudFront com Origin Access Control);
2. sincroniza a pasta `web/` para o bucket;
3. invalida o cache do CloudFront;
4. imprime a URL pública (`https://dXXXXXXXX.cloudfront.net`).

Para remover tudo: esvazie o bucket e apague a stack:

```bash
aws s3 rm s3://BUCKET --recursive
aws cloudformation delete-stack --stack-name yom-kippur-game
```

## O jogo

- **6 rodadas**, cada uma com 8 fases (movimentação → designação de ataques →
  cobertura defensiva → resolução; primeiro Israel, depois Egito).
- **Israel** entra pelo leste (estrada de Jerusalém, casa 2505, e casa 1922) e precisa:
  destruir/capturar as 3 bases **SAM**, controlar as duas entradas de **Ismaília**
  (0803 e 1202) e uma entrada de **Fahid** (0621 ou 0722).
- **Egito** vence impedindo os objetivos israelenses; vitória decisiva se Israel perder
  mais unidades do que mantiver na margem oeste ao fim do jogo.
- O **Canal de Suez** só pode ser cruzado pela ponte de Ismaília ou pela ponte que a
  unidade de **engenharia** israelense instalar entre os lagos — o que também libera
  os reforços israelenses (3 tanques + 3 transportes) na rodada seguinte.
- Egito recebe reforços programados nas rodadas 3, 4 e 5 (entradas 1201, 0621, 0722).
- Combate clássico de CRT: razão de forças → coluna (−2 a +2), 2d6 na Tabela de
  Efeitos de Combate; terreno dá bônus defensivo; estradas o anulam; unidades com
  baixas viram o verso e são eliminadas na segunda baixa.

## Estrutura do projeto

```
web/                  aplicação (HTML/CSS/JS puro, sem build)
  js/map-data.js      tabuleiro nº 4 extraído do PDF (538 hexágonos, estradas, canais)
  js/units.js         as 45 peças (24 egípcias, 21 israelenses)
  js/rules.js         motor de regras (movimento, ZOC, combate, recuo, vitória)
  js/game.js          máquina de estados (rodadas, fases, reforços, ponte)
  js/ai.js            IA heurística (joga qualquer lado)
  js/ui.js            tabuleiro SVG, interação, modais de decisão
tests/test.mjs        testes do motor (node tests/test.mjs)
run-local.sh          servidor local
deploy/aws/           CloudFormation + script de deploy (S3 + CloudFront)
files/                documentação original digitalizada (PDFs)
work/                 artefatos da extração do mapa (calibração, máscaras)
```

## Reinforcement Learning

O diretório [`rl/`](rl/RL.md) traz um sistema completo de treino por RL sobre o
motor do jogo: ambiente vetorizado em Node (`env.mjs` + `worker.mjs`), treinador
PPO em PyTorch (`train.py`), dashboard de evolução em HTML autônomo (taxa de
vitória, recompensa, entropia — atualizado ao vivo durante o treino) e replay de
checkpoints contra a IA heurística (`play-checkpoint.mjs`). As políticas treinadas
(ISR e EGY, ambas > 95% de vitória vs heurística) estão **jogáveis no próprio
jogo**: na tela inicial, escolha o tipo de adversário **"Neural"** para enfrentar a
rede em vez da heurística. Veja [`rl/RL.md`](rl/RL.md) para o projeto e os comandos,
e [`rl/explicacao.html`](rl/explicacao.html) para a explicação visual do sistema.

## Testes

```bash
node tests/test.mjs
```

Cobrem a grade hexagonal, custos de movimento, zonas de engajamento, travessias do
canal, tabelas de combate, recuos/baixas, reforços, condições de vitória e partidas
IA×IA completas com verificação de invariantes.

## Notas de fidelidade

- O terreno foi extraído por classificação de cores do scan original, com revisão
  manual de estradas, canais, cidades e posições iniciais (caixas brancas do tabuleiro).
- O canal de água doce é modelado fielmente como feature de aresta (+3 por
  travessia, grátis nas pontes de estrada), correndo entre os hexágonos no
  traçado do mapa original.
- Simplificação documentada: a rendição antecipada ("render-se") não foi
  implementada — as partidas vão até a rodada 6.
