// (1) GERADOR DE PLANOS via LLM, ATERRADO pelo motor (modelo híbrido opção A).
//
// O LLM PROPÕE planos estratégicos de alto nível em JSON; o motor + a cabeça de
// valor VERIFICAM (em ai-macro.js). Aqui ficam: serialização do estado para texto,
// a chamada à API Claude, o parsing/validação dos planos (grounding — alvos
// ilegais são descartados) e a conversão para a função de override de alvos que o
// executor de baixo nível (movimentação heurística) consome.
//
// O "skill document" (SKILL_DOC) é o ALVO de otimização do SkillOpt (passo 4).
import { readFileSync } from 'fs';

// ---------------------------------------------------------------- API LLM
// provedor inferido pelo nome do modelo (claude* = Anthropic; gpt*/o[1-9]* = OpenAI)
export function provedorDoModelo(model) {
  return /^(gpt|o[1-9]|chatgpt)/i.test(model) ? 'openai' : 'anthropic';
}

async function chamarAnthropic({ system, user, model, max_tokens }) {
  const key = process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('chave ausente (LLM_API_KEY / ANTHROPIC_API_KEY)');
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const d = await resp.json();
  return (d.content || []).map(b => b.text || '').join('');
}

async function chamarOpenAI({ system, user, model, max_tokens }) {
  const key = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) throw new Error('chave ausente (LLM_API_KEY / OPENAI_API_KEY)');
  // GPT-5 e a série o* são modelos de raciocínio: usam max_completion_tokens
  // (não max_tokens), aceitam reasoning_effort e consomem tokens no raciocínio
  // (precisam de orçamento maior para sobrar saída).
  const raciocinio = /^(o[1-9]|gpt-5)/i.test(model);
  const body = {
    model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_object' },
  };
  if (raciocinio) {
    body.max_completion_tokens = Math.max(max_tokens, 4000);
    body.reasoning_effort = process.env.LLM_EFFORT || 'low';   // barato/rápido p/ planos
  } else {
    body.max_tokens = max_tokens;
  }
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`OpenAI ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const d = await resp.json();
  return d.choices?.[0]?.message?.content || '';
}

// dispatcher agnóstico de provedor (nome mantido por compat com skillopt.mjs)
export async function chamarClaude({ system, user, model = 'claude-haiku-4-5', max_tokens = 1500 }) {
  const fn = provedorDoModelo(model) === 'openai' ? chamarOpenAI : chamarAnthropic;
  return fn({ system, user, model, max_tokens });
}

// extrai o 1º objeto JSON balanceado de um texto (tolerante a ```json e prosa)
export function extrairJSON(txt) {
  const i = txt.indexOf('{');
  if (i < 0) return null;
  let prof = 0;
  for (let j = i; j < txt.length; j++) {
    if (txt[j] === '{') prof++;
    else if (txt[j] === '}' && --prof === 0) {
      try { return JSON.parse(txt.slice(i, j + 1)); } catch { return null; }
    }
  }
  return null;
}

// ---------------------------------------------------------------- serialização
// estado -> texto compacto para o LLM (perspectiva do atacante ISR)
export function serializar(YK, state) {
  const L = [];
  L.push(`Rodada ${state.round} de 6. Ponte israelense: ${state.ponteRodada ? `instalada (rodada ${state.ponteRodada})` : 'NÃO instalada'}.`);
  const objs = YK.IA.OBJ_ISR;
  const ctrl = objs.map(h => `${h}${YK.controla(state, h, 'ISR') ? '=ISR' : '=livre/EGY'}`);
  L.push(`Objetivos ISR (cidades-alvo): ${ctrl.join(', ')}.`);
  const sams = (YK.IA.SAM_HEXES ? YK.IA.SAM_HEXES() : []).map(h => {
    const u = YK.unidadeEm(state, h); return `${h}${u && u.tipo === 'sam' && !u.dead ? '=viva' : '=neutralizada'}`;
  });
  L.push(`SAMs egípcias: ${sams.join(', ')}.`);
  const desc = (lado) => state.units.filter(u => u.side === lado && !u.dead && u.hex && u.tipo !== 'sam')
    .map(u => `${u.tipo}@${u.hex}(CI${YK.icAtual(u)}${YK.engajada(state, u) ? ',engajada' : ''})`).join(' ');
  L.push(`Unidades ISR no tabuleiro: ${desc('ISR') || '(nenhuma)'}.`);
  L.push(`Unidades EGY no tabuleiro: ${desc('EGY') || '(nenhuma)'}.`);
  const pool = YK.poolEntrada(state, 'ISR').map(u => u.tipo);
  if (pool.length) L.push(`Reforços ISR disponíveis para entrar: ${pool.join(', ')}.`);
  return L.join('\n');
}

// ---------------------------------------------------------------- grounding
// plano estruturado -> função (state,u)->[hexes] (override de alvos), validando
// hexes contra o mapa. Papéis: combate / engenharia / artilharia. null = doutrina.
export function planoParaAlvos(YK, plano) {
  const validos = (arr) => (Array.isArray(arr) ? arr : []).filter(h => YK.MAP.terrain[h]);
  const t = plano.targets || plano.alvos || {};
  const comb = validos(t.combate || t.combat);
  const eng = validos(t.engenharia || t.engineer);
  const art = validos(t.artilharia || t.artillery);
  return (state, u) => {
    if (u.side !== 'ISR') return null;
    if (u.tipo === 'eng') return eng.length ? eng : null;
    if (YK.ehArtilharia(u)) return art.length ? art : null;
    if (!state.ponteRodada) return null;            // pré-ponte: escolta (doutrina)
    if (!comb.length) return null;
    const pend = comb.filter(h => !YK.controla(state, h, 'ISR'));
    return pend.length ? pend : comb;
  };
}

// converte a resposta do LLM (lista de planos) em planos do executor {nome, alvos}
export function planosDaResposta(YK, obj) {
  const lista = (obj && (obj.plans || obj.planos)) || [];
  const out = [];
  for (const p of lista) {
    const nome = (p.name || p.nome || 'PLANO').toString().slice(0, 24);
    out.push({ nome, alvos: planoParaAlvos(YK, p), _rac: p.rationale || p.justificativa || '' });
  }
  return out;
}

// ---------------------------------------------------------------- skill document
// ESTE texto é o alvo de otimização (SkillOpt). Mantê-lo conciso e acionável.
export const SKILL_DOC = `Você é o general israelense (atacante) em "A Guerra do Yom Kippur".
Em 6 rodadas precisa: instalar a ponte sobre o Canal de Suez, atravessar para a
margem oeste e CONTROLAR as cidades-objetivo (0803, 1202, 0621, 0722); neutralizar
SAMs ajuda. O defensor egípcio é estruturalmente favorecido, então concentre força:
espalhar unidades por objetivos distantes costuma falhar.

Princípios:
- A ponte é pré-requisito de tudo; antes dela, a doutrina escolta a engenharia
  automaticamente (não atribua alvos de combate antes da ponte).
- Pós-ponte, escolha 1-2 objetivos próximos entre si e concentre as unidades de
  combate neles, em vez de dividir as forças.
- Considere as rodadas restantes: cedo, garanta a travessia; tarde, force objetivos.
- Artilharia apoia (não precisa de alvo); deixe null salvo motivo claro.

Proponha de 3 a 5 planos DISTINTOS e plausíveis para a posição atual.`;

export const INSTRUCAO_SAIDA = `Responda SOMENTE com JSON neste formato:
{"plans":[{"name":"NOME_CURTO","rationale":"1 frase","targets":{"combate":["1202","0722"],"engenharia":null,"artilharia":null}}]}
Use apenas códigos de casa de 4 dígitos (coluna+linha) existentes. "combate" lista
os objetivos onde concentrar as unidades de combate; null usa a doutrina padrão.`;

// gera planos chamando o LLM (ou lança se sem chave)
export async function gerarPlanosLLM(YK, state, opts = {}) {
  const skill = opts.skill || SKILL_DOC;
  const txt = await chamarClaude({
    system: skill + '\n\n' + INSTRUCAO_SAIDA,
    user: 'Posição atual:\n' + serializar(YK, state),
    model: opts.model || process.env.LLM_MODEL || 'claude-haiku-4-5',
    max_tokens: opts.max_tokens || 1500,
  });
  const obj = extrairJSON(txt);
  const planos = planosDaResposta(YK, obj || {});
  return planos.length ? planos : null;     // null => caller cai nos planos fixos
}

// provedor compatível com ai-macro: (state,lado)->Promise<[{nome,alvos}]>
export function provedorLLM(YK, opts = {}) {
  return async (state, lado) => (lado === 'ISR' ? await gerarPlanosLLM(YK, state, opts) : null);
}

// provedor MOCK (sem API): planos determinísticos para validar o encanamento.
// Espelha o vocabulário fixo do macro, via o mesmo caminho de grounding.
export function provedorMock(YK) {
  const defs = [
    { name: 'TODOS', targets: {} },
    { name: 'NORTE', targets: { combate: ['1202', '0722'] } },
    { name: 'SUL', targets: { combate: ['0803', '0621'] } },
    { name: 'SAMS', targets: { combate: YK.IA.SAM_HEXES ? YK.IA.SAM_HEXES() : [] } },
  ];
  return async (state, lado) => (lado === 'ISR' ? planosDaResposta(YK, { plans: defs }) : null);
}

export function carregarSkill(caminho) {
  return caminho ? readFileSync(caminho, 'utf8') : SKILL_DOC;
}
