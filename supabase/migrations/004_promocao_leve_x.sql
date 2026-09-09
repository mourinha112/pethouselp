-- =====================================================================
-- THE PET HOUSE - Promoção "leve X por R$ Y" nos produtos vendidos por unidade
-- Rode este arquivo inteiro no Supabase > SQL Editor > New query > Run.
-- É idempotente: pode rodar mais de uma vez sem quebrar nada.
--
-- Exemplo: sachê a R$ 3,50 a unidade, e "leve 4 por R$ 12".
-- Quem leva 5 paga 12 + 3,50. Quem leva 8 paga 24.
-- O estoque continua baixando unidade a unidade; só o preço muda.
-- =====================================================================

alter table public.products add column if not exists promo_qtd   integer;
alter table public.products add column if not exists promo_preco numeric(10,2);

comment on column public.products.promo_qtd   is 'quantas unidades fecham o combo ("leve 4"); null = sem promoção';
comment on column public.products.promo_preco is 'preço do combo fechado ("por R$ 12")';

-- Promoção só faz sentido com os dois campos preenchidos e positivos.
-- Se um dos dois vier vazio, a loja ignora a promoção inteira.
alter table public.products drop constraint if exists products_promo_coerente;
alter table public.products add constraint products_promo_coerente check (
  (promo_qtd is null and promo_preco is null)
  or (promo_qtd >= 2 and promo_preco > 0)
);
