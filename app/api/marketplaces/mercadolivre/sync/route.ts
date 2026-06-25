import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Variaveis de ambiente incompletas." },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  const userToken = authHeader?.replace("Bearer ", "");

  if (!userToken) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { authorization: `Bearer ${userToken}` } }
  });

  const {
    data: { user },
    error: authError
  } = await userClient.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Token invalido." }, { status: 401 });
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: orgs } = await serviceClient
    .from("organizations")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1);

  const organizationId = orgs?.[0]?.id as string | undefined;

  if (!organizationId) {
    return NextResponse.json(
      { error: "Nenhuma empresa encontrada para este usuario." },
      { status: 404 }
    );
  }

  const { data: membership } = await serviceClient
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  const { data: accounts } = await serviceClient
    .from("marketplace_accounts")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("provider", "mercadolivre")
    .eq("status", "connected");

  if (!accounts || accounts.length === 0) {
    return NextResponse.json(
      { error: "Nenhuma conta Mercado Livre conectada." },
      { status: 404 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    days_back?: number;
  };
  const daysBack = typeof body.days_back === "number" ? body.days_back : 30;

  const results = await Promise.allSettled(
    accounts.map((account) =>
      fetch(`${supabaseUrl}/functions/v1/mercadolivre-sync-orders`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          marketplace_account_id: account.id,
          organization_id: organizationId,
          days_back: daysBack
        })
      }).then((res) => res.json())
    )
  );

  const summary = results.map((result, index) => ({
    account_id: accounts[index].id,
    ...(result.status === "fulfilled"
      ? result.value
      : { error: String(result.reason) })
  }));

  return NextResponse.json({ ok: true, accounts: summary });
}
