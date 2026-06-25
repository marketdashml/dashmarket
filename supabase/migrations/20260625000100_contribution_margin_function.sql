-- Funcao que agrega vendas reais (orders + order_items), custos por SKU
-- (sku_costs) e publicidade (advertising_metrics) em snapshots de margem
-- de contribuicao por produto. Custos de nivel de pedido (frete, descontos,
-- impostos) sao rateados entre os itens proporcionalmente ao valor bruto.

create or replace function public.refresh_contribution_margins(
  target_organization_id uuid,
  period_days integer default 30
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer := 0;
  period_start_date date := (current_date - (period_days - 1));
  period_end_date date := current_date;
  from_ts timestamptz := (now() - make_interval(days => period_days));
begin
  with item_alloc as (
    select
      oi.product_id,
      oi.order_id,
      oi.quantity,
      oi.gross_amount,
      oi.marketplace_fee_amount,
      case when o.gross_amount > 0
        then o.shipping_cost_amount * (oi.gross_amount / o.gross_amount) else 0 end as shipping_alloc,
      case when o.gross_amount > 0
        then o.discounts_amount * (oi.gross_amount / o.gross_amount) else 0 end as discount_alloc,
      case when o.gross_amount > 0
        then o.taxes_amount * (oi.gross_amount / o.gross_amount) else 0 end as tax_alloc
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.organization_id = target_organization_id
      and o.organization_id = target_organization_id
      and o.sold_at >= from_ts
      and o.status <> 'cancelled'
      and oi.product_id is not null
  ),
  sales as (
    select
      product_id,
      count(distinct order_id) as orders_count,
      sum(quantity) as units,
      sum(gross_amount) as gross,
      sum(marketplace_fee_amount) as fees,
      sum(shipping_alloc) as shipping,
      sum(discount_alloc) as discounts,
      sum(tax_alloc) as taxes
    from item_alloc
    group by product_id
  ),
  costs as (
    select
      s.product_id,
      sum(
        case sc.allocation_method
          when 'per_unit' then sc.amount * s.units
          when 'percentage' then s.gross * (sc.amount / 100.0)
          when 'per_order' then sc.amount * s.orders_count
          else 0
        end
      ) as sku_cost
    from sales s
    join public.sku_costs sc
      on sc.product_id = s.product_id
      and sc.organization_id = target_organization_id
      and sc.valid_from <= current_date
      and (sc.valid_to is null or sc.valid_to >= current_date)
    group by s.product_id
  ),
  ads as (
    select product_id, sum(ad_spend_amount) as spend
    from public.advertising_metrics
    where organization_id = target_organization_id
      and product_id is not null
      and metric_date >= period_start_date
    group by product_id
  ),
  computed as (
    select
      s.product_id,
      s.units,
      s.gross,
      s.discounts,
      s.fees,
      s.shipping,
      s.taxes,
      coalesce(c.sku_cost, 0) as sku_cost,
      coalesce(a.spend, 0) as ad_spend,
      (s.gross - s.discounts) as net_revenue
    from sales s
    left join costs c on c.product_id = s.product_id
    left join ads a on a.product_id = s.product_id
  )
  insert into public.contribution_margin_snapshots (
    organization_id, product_id, period_start, period_end,
    units_sold, gross_revenue_amount, discounts_amount,
    marketplace_fees_amount, shipping_cost_amount, advertising_cost_amount,
    sku_cost_amount, contribution_margin_amount, contribution_margin_percent,
    raw_components
  )
  select
    target_organization_id,
    product_id,
    period_start_date,
    period_end_date,
    units,
    gross,
    discounts,
    fees,
    shipping,
    ad_spend,
    sku_cost,
    (net_revenue - fees - shipping - taxes - sku_cost - ad_spend) as margin,
    case when net_revenue > 0
      then (net_revenue - fees - shipping - taxes - sku_cost - ad_spend) / net_revenue
      else null end,
    jsonb_build_object('taxes', taxes, 'net_revenue', net_revenue)
  from computed
  on conflict (organization_id, product_id, period_start, period_end)
  do update set
    units_sold = excluded.units_sold,
    gross_revenue_amount = excluded.gross_revenue_amount,
    discounts_amount = excluded.discounts_amount,
    marketplace_fees_amount = excluded.marketplace_fees_amount,
    shipping_cost_amount = excluded.shipping_cost_amount,
    advertising_cost_amount = excluded.advertising_cost_amount,
    sku_cost_amount = excluded.sku_cost_amount,
    contribution_margin_amount = excluded.contribution_margin_amount,
    contribution_margin_percent = excluded.contribution_margin_percent,
    raw_components = excluded.raw_components;

  get diagnostics affected = row_count;
  return affected;
end;
$$;
