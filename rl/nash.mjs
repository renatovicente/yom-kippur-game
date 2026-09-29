// Equilíbrio de Nash de um jogo matricial de SOMA CONSTANTE (Israel maximiza a
// sua taxa de vitória, Egito minimiza), por PESOS MULTIPLICATIVOS (hedge) com média
// das estratégias — converge para o equilíbrio em jogos de soma zero.
// Devolve { valor, pIsr, pEgy, explorIsr, explorEgy } onde explor* é o ganho do
// melhor contra-ataque contra a mistura (gap de equilíbrio: 0 no Nash exato).
export function nash(M, iters = 20000) {
  const nI = M.length, nE = M[0].length;
  let wI = Array(nI).fill(1), wE = Array(nE).fill(1);
  const somaI = Array(nI).fill(0), somaE = Array(nE).fill(0);
  const eta = Math.sqrt(8 * Math.log(Math.max(nI, nE, 2)) / iters);
  for (let t = 0; t < iters; t++) {
    const zI = wI.reduce((a, b) => a + b, 0), zE = wE.reduce((a, b) => a + b, 0);
    const pI = wI.map(w => w / zI), pE = wE.map(w => w / zE);
    for (let i = 0; i < nI; i++) somaI[i] += pI[i];
    for (let j = 0; j < nE; j++) somaE[j] += pE[j];
    // ganho de cada linha contra pE e de cada coluna contra pI
    const gI = M.map(row => row.reduce((s, v, j) => s + v * pE[j], 0));
    const gE = Array.from({ length: nE }, (_, j) => M.reduce((s, row, i) => s + row[j] * pI[i], 0));
    wI = wI.map((w, i) => w * Math.exp(eta * gI[i]));
    wE = wE.map((w, j) => w * Math.exp(-eta * gE[j]));
    const mI = Math.max(...wI), mE = Math.max(...wE);    // estabilidade numérica
    wI = wI.map(w => w / mI); wE = wE.map(w => w / mE);
  }
  const pIsr = somaI.map(s => s / iters), pEgy = somaE.map(s => s / iters);
  const valor = M.reduce((s, row, i) => s + pIsr[i] * row.reduce((t, v, j) => t + v * pEgy[j], 0), 0);
  const brI = Math.max(...M.map(row => row.reduce((s, v, j) => s + v * pEgy[j], 0)));
  const brE = Math.min(...Array.from({ length: nE }, (_, j) => M.reduce((s, row, i) => s + row[j] * pIsr[i], 0)));
  return { valor, pIsr, pEgy, explorIsr: brI - valor, explorEgy: valor - brE };
}
