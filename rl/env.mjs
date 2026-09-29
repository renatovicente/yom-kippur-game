// Ambiente de RL (estilo gym) sobre o motor do jogo.
// API: const env = new YKEnv({side:'ISR'}); await env.reset(seed);
//      while (!r.done) r = await env.step(acao);
//
// Espaço de ações (discreto, com máscara): índice de casa 0..537 + AÇÃO_PASSAR.
// Cada step decide UMA microdecisão. A codificação (fila, observação, máscara,
// aplicação de ação) vem de web/js/rl-core.js — a MESMA usada na inferência do
// jogo, garantindo que a rede veja idêntico formato no treino e ao jogar.
// v1: as escolhas da fase de resolução (baixas/recuo/avanço) usam a heurística.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['map-data.js', 'units.js', 'rules.js', 'game.js', 'ai.js', 'rl-core.js', 'ai-neural.js'])
  (0, eval)(readFileSync(join(root, 'web/js', f), 'utf8'));
const YK = globalThis.YK;
const RL = YK.RL;

// configuração do OPONENTE (global ao processo: todos os ambientes do worker a
// compartilham). pesos: {ISR:{...},EGY:{...}} da heurística (null = ∞);
// oponente: {tipo:'heur'} (padrão) ou {tipo:'neural', modelo:'web/models/X.json'}
// — permite treinar contra um adversário fixo mais forte (co-evolução / PSRO).
export function configurarOponente({ pesos, oponente, ladoTreino } = {}) {
  YK.IA.resetPesos();
  for (const lado of ['ISR', 'EGY']) {
    if (!pesos || !pesos[lado]) continue;
    const p = {};
    for (const [k, v] of Object.entries(pesos[lado])) p[k] = (v === null || v === 'inf') ? Infinity : v;
    YK.IA.setPesos(lado, p);
  }
  JOGADOR_OPONENTE = YK.IA;
  MISTURA = null;
  if (!oponente || ladoTreino === 'both') return;
  const lado = ladoTreino === 'ISR' ? 'EGY' : 'ISR';
  if (oponente.tipo === 'neural') {
    YK.IANeural.definir(lado, compila(oponente.modelo), oponente.modelo);
    JOGADOR_OPONENTE = YK.IANeural;
  } else if (oponente.tipo === 'mistura') {
    // PSRO: um oponente sorteado POR PARTIDA de uma mistura (ex.: Nash da população)
    const tot = oponente.itens.reduce((s, it) => s + it.p, 0);
    MISTURA = { lado, itens: oponente.itens.map(it => ({
      p: it.p / tot, tipo: it.tipo || 'heur',
      pesos: normPesos(it.pesos), m: it.tipo === 'neural' ? compila(it.modelo) : null, modelo: it.modelo,
    })) };
  }
}
let JOGADOR_OPONENTE = YK.IA;
let MISTURA = null;
const cacheModelos = new Map();
function compila(caminho) {
  if (!cacheModelos.has(caminho)) {
    const pj = JSON.parse(readFileSync(join(root, caminho), 'utf8'));
    cacheModelos.set(caminho, pj.layers ? YK.IANeural.compilaSpec(pj) : YK.IANeural.compilaLegado(pj));
  }
  return cacheModelos.get(caminho);
}
function normPesos(p) {
  const o = {};
  for (const [k, v] of Object.entries(p || {})) o[k] = (v === null || v === 'inf') ? Infinity : v;
  return o;
}
// prepara o oponente sorteado desta partida e devolve quem joga a fase dele
function jogadorDaMistura(item) {
  YK.IA.setPesos(MISTURA.lado, { ...YK.IA.PESOS_PADRAO, ...item.pesos });
  if (item.tipo === 'neural') { YK.IANeural.definir(MISTURA.lado, item.m, item.modelo); return YK.IANeural; }
  return YK.IA;
}

export const HEXES = RL.HEXES;
export const ACAO_PASSAR = RL.ACAO_PASSAR;
export const N_ACOES = RL.N_ACOES;
export const OBS_TAM = RL.OBS_TAM;

const RECOMPENSA = { decisiva: 1.0, parcial: 0.6, marginal: 0.3, empate: 0.0 };

export class YKEnv {
  // side: 'ISR' | 'EGY' (vs IA heurística) | 'both' (self-play)
  constructor({ side = 'ISR' } = {}) {
    this.side = side;
  }

  _eMeu(lado) { return this.side === 'both' || lado === this.side; }
  _ladoAtual() {
    const d = this.fila[0];
    return d ? d.lado : (this.side === 'both' ? 'ISR' : this.side);
  }

  async reset(seed) {
    this.state = YK.novoJogo({ modos: { ISR: 'ia', EGY: 'ia' }, seed });
    if (MISTURA) {                         // sorteio determinístico pela seed
      let r = ((Math.imul(seed ^ 0x9E3779B9, 2654435761) >>> 0) % 1000000) / 1000000, k = 0;
      while (k < MISTURA.itens.length - 1 && (r -= MISTURA.itens[k].p) > 0) k++;
      this.opItem = MISTURA.itens[k];
    }
    this.fila = [];
    this.filaFase = -1;
    this.decisoes = 0;
    await this._avancar();
    return this._saida(0);
  }

  // corre o jogo até a próxima decisão da política
  async _avancar() {
    const st = this.state;
    while (!st.fim) {
      if (this.fila.length) {
        if (RL.temAcaoReal(RL.mascaraDecisao(st, this.fila[0]))) return;
        this.fila.shift();   // decisão sem opção real: resolve sozinha
        continue;
      }
      const f = YK.faseAtual(st);
      if (f.kind === 'resolve') {
        await YK.resolverTudo(st, (cb, lado) => YK.decisorAuto(st, cb, lado));
        YK.proximaFase(st);
        continue;
      }
      if (!this._eMeu(f.side)) {
        const jog = (MISTURA && this.opItem) ? jogadorDaMistura(this.opItem) : JOGADOR_OPONENTE;
        await jog.jogarFase(st);
        YK.proximaFase(st);
        continue;
      }
      const marca = st.round * 10 + st.fase;
      if (this.filaFase !== marca) {
        this.filaFase = marca;
        this.fila = RL.montarFila(st, f.side);
      }
      if (!this.fila.length) YK.proximaFase(st);
    }
  }

  async step(acao) {
    const st = this.state;
    if (st.fim) throw new Error('partida encerrada — chame reset()');
    const d = this.fila[0];
    const mask = RL.mascaraDecisao(st, d);
    if (!mask[acao]) acao = ACAO_PASSAR;   // ação ilegal degrada para "passar"
    this.decisoes++;
    const { resto } = RL.aplicarDecisao(st, d, acao);
    this.fila.shift();
    if (resto) this.fila.unshift(resto);
    await this._avancar();
    return this._saida();
  }

  observar(lado) { return RL.observar(this.state, lado || this._ladoAtual()); }

  // potencial do ATACANTE (ISR) para reward shaping baseado em potencial
  // (Ng et al. 1999): shaping = γΦ(s') − Φ(s) preserva a política ótima.
  // Cresce com o progresso da operação anfíbia. Campo aditivo — ignorado pelos
  // scripts de produção (train.py, selfplay.py); usado por rl/research.py.
  potencialAtacante() {
    const st = this.state;
    let phi = 0;
    if (YK.pontesEng(st)) phi += 0.25;                          // ponte instalada
    phi += 0.10 * st.units.filter(u => u.tipo === 'sam' && u.dead).length;   // SAMs neutralizadas
    phi += 0.15 * YK.objetivosIsraelenses(st).total;           // objetivos controlados (0-3)
    phi += 0.03 * st.units.filter(u =>                          // cabeça-de-ponte a oeste
      u.side === 'ISR' && !u.dead && u.hex && YK.oeste(u.hex)).length;
    return phi;
  }

  _saida() {
    const st = this.state;
    const done = !!st.fim;
    const lado = this._ladoAtual();
    let reward = 0;   // em modo 'both', recompensa na perspectiva de ISR
    if (done && st.fim.vencedor) {
      const ref = this.side === 'both' ? 'ISR' : this.side;
      reward = RECOMPENSA[st.fim.tipo] * (st.fim.vencedor === ref ? 1 : -1);
    }
    return {
      obs: this.observar(lado),
      mask: done ? new Uint8Array(N_ACOES) : RL.mascaraDecisao(st, this.fila[0]),
      reward, done, lado,
      info: { round: st.round, fase: st.fase, decisoes: this.decisoes,
              fim: st.fim || null },
    };
  }
}
