alter table public.order_items
  add constraint order_items_order_external_item_unique
  unique (order_id, external_item_id);
