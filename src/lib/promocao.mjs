/*
 * Promoção "leve X por R$ Y" em produtos vendidos por unidade.
 *
 * A mesma conta roda na loja (para mostrar o total na hora) e no servidor
 * (para fechar o pedido). Se os dois divergirem, o cliente vê um preço e
 * paga outro — por isso a regra mora aqui e só aqui.
 *
 * Exemplo: unidade a 3,50 e "leve 4 por 12".
 *   3 un -> 10,50      (nenhum combo fechado)
 *   4 un -> 12,00      (um combo)
 *   5 un -> 15,50      (um combo + 1 avulsa)
 *   8 un -> 24,00      (dois combos)
 */

export function temPromocao(p) {
  return Number(p?.promo_qtd) >= 2 && Number(p?.promo_preco) > 0;
}

/** Total a pagar por `qtd` unidades de `p`. */
export function totalUnidades(p, qtd) {
  const n = Math.max(0, Math.round(Number(qtd) || 0));
  const unit = Number(p?.preco_unitario) || 0;
  if (!temPromocao(p)) return arredonda(n * unit);

  const combo = Number(p.promo_qtd);
  const combos = Math.floor(n / combo);
  const avulsas = n % combo;
  return arredonda(combos * Number(p.promo_preco) + avulsas * unit);
}

/** Quanto o cliente deixa de pagar em relação ao preço unitário cheio. */
export function economiaUnidades(p, qtd) {
  const n = Math.max(0, Math.round(Number(qtd) || 0));
  return arredonda(n * (Number(p?.preco_unitario) || 0) - totalUnidades(p, n));
}

function arredonda(v) {
  return Math.round(v * 100) / 100;
}
