-- Agendamento automatico das sincronizacoes do Mercado Livre.
--
-- Usa pg_cron para disparar as Edge Functions periodicamente via pg_net.
-- As credenciais (URL do projeto e service_role key) ficam no Supabase Vault,
-- nunca em texto plano nesta migration.
--
-- PRE-REQUISITO (rodar UMA vez no SQL Editor, com seus valores reais):
--
--   select vault.create_secret(
--     'https://SEU-PROJETO.supabase.co', 'project_url', 'URL do projeto');
--   select vault.create_secret(
--     'SUA_SERVICE_ROLE_KEY', 'service_role_key', 'Service role key');
--
-- Sem esses segredos os jobs simplesmente nao fazem nada (saem silenciosos).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Funcao auxiliar que invoca uma Edge Function via HTTP usando os segredos.
create or replace function public.invoke_edge_function(
  function_name text,
  payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  base_url text;
  service_key text;
begin
  select decrypted_secret into base_url
  from vault.decrypted_secrets where name = 'project_url' limit 1;

  select decrypted_secret into service_key
  from vault.decrypted_secrets where name = 'service_role_key' limit 1;

  if base_url is null or service_key is null then
    raise notice 'Segredos project_url/service_role_key ausentes no Vault.';
    return;
  end if;

  perform net.http_post(
    url := base_url || '/functions/v1/' || function_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key,
      'apikey', service_key
    ),
    body := payload,
    timeout_milliseconds := 280000
  );
end;
$$;

-- Sincronizacao completa (listings, orders, inventory, ads, margem) a cada 2h.
select cron.schedule(
  'ml-sync-all',
  '0 */2 * * *',
  $$select public.invoke_edge_function('mercadolivre-sync-all', '{"days_back":30}'::jsonb)$$
);

-- Processa webhooks acumulados (vendas em quase tempo real) a cada 5 min.
select cron.schedule(
  'ml-process-events',
  '*/5 * * * *',
  $$select public.invoke_edge_function('mercadolivre-process-events', '{"limit":200}'::jsonb)$$
);
