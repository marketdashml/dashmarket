import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

export type Env = {
  supabaseUrl: string;
  serviceRoleKey: string;
  clientId: string;
  clientSecret: string;
};

export function readEnv(): Env {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const clientId = Deno.env.get("MERCADOLIVRE_CLIENT_ID");
  const clientSecret = Deno.env.get("MERCADOLIVRE_CLIENT_SECRET");

  if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret) {
    throw new Error("Variaveis de ambiente incompletas.");
  }

  return { supabaseUrl, serviceRoleKey, clientId, clientSecret };
}

export function createServiceClient(env: Env): SupabaseClient {
  return createClient(env.supabaseUrl, env.serviceRoleKey);
}

const ML_BASE = "https://api.mercadolibre.com";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cliente da API do Mercado Livre com refresh de token automatico,
 * backoff exponencial e tratamento de rate limit (429).
 */
export class MercadoLivreClient {
  private accessToken: string;
  private refreshToken: string | null;
  private expiresAt: number | null;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly env: Env,
    private readonly accountId: string,
    credentials: {
      access_token: string;
      refresh_token: string | null;
      token_expires_at: string | null;
    }
  ) {
    this.accessToken = credentials.access_token;
    this.refreshToken = credentials.refresh_token;
    this.expiresAt = credentials.token_expires_at
      ? new Date(credentials.token_expires_at).getTime()
      : null;
  }

  static async forAccount(
    supabase: SupabaseClient,
    env: Env,
    accountId: string
  ): Promise<MercadoLivreClient> {
    const { data, error } = await supabase
      .from("marketplace_account_credentials")
      .select("access_token, refresh_token, token_expires_at")
      .eq("account_id", accountId)
      .single();

    if (error || !data) {
      throw new Error(`Credenciais nao encontradas para a conta ${accountId}.`);
    }

    return new MercadoLivreClient(supabase, env, accountId, {
      access_token: data.access_token as string,
      refresh_token: (data.refresh_token as string | null) ?? null,
      token_expires_at: (data.token_expires_at as string | null) ?? null
    });
  }

  private async ensureFreshToken(): Promise<void> {
    const needsRefresh =
      this.expiresAt !== null && this.expiresAt - Date.now() < 5 * 60 * 1000;

    if (!needsRefresh || !this.refreshToken) return;

    const response = await fetch(`${ML_BASE}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: this.env.clientId,
        client_secret: this.env.clientSecret,
        refresh_token: this.refreshToken
      })
    });

    if (!response.ok) return;

    const token = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    this.accessToken = token.access_token;
    this.refreshToken = token.refresh_token ?? this.refreshToken;
    this.expiresAt = token.expires_in
      ? Date.now() + token.expires_in * 1000
      : null;

    await this.supabase
      .from("marketplace_account_credentials")
      .update({
        access_token: this.accessToken,
        refresh_token: this.refreshToken,
        token_expires_at: this.expiresAt
          ? new Date(this.expiresAt).toISOString()
          : null
      })
      .eq("account_id", this.accountId);
  }

  /**
   * GET com backoff. Faz ate `maxRetries` tentativas em 429/5xx.
   * Lanca erro em outros status nao-ok.
   */
  async get<T>(
    path: string,
    opts: { maxRetries?: number; headers?: Record<string, string> } = {}
  ): Promise<T> {
    const maxRetries = opts.maxRetries ?? 4;
    await this.ensureFreshToken();

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = await fetch(`${ML_BASE}${path}`, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          ...(opts.headers ?? {})
        }
      });

      if (response.ok) {
        return (await response.json()) as T;
      }

      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < maxRetries) {
        const retryAfter = Number(response.headers.get("retry-after")) || 0;
        const backoff = retryAfter * 1000 || 2 ** attempt * 500;
        await sleep(backoff);
        continue;
      }

      if (response.status === 401) {
        // Token pode ter expirado durante a execucao; tenta refresh uma vez.
        this.expiresAt = 0;
        await this.ensureFreshToken();
        if (attempt < maxRetries) continue;
      }

      throw new Error(
        `ML API ${response.status} em ${path}: ${await response.text()}`
      );
    }

    throw new Error(`ML API falhou apos ${maxRetries} tentativas em ${path}.`);
  }

  /**
   * Tenta o GET mas retorna null em erro 403/404 (recurso indisponivel
   * para a conta, ex: vendedor sem publicidade). Util para syncs opcionais.
   */
  async tryGet<T>(
    path: string,
    opts: { headers?: Record<string, string> } = {}
  ): Promise<T | null> {
    try {
      return await this.get<T>(path, opts);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes(" 403 ") || message.includes(" 404 ")) {
        return null;
      }
      throw error;
    }
  }
}

export type SyncResult = {
  resource: string;
  records_processed: number;
  error?: string;
};

/**
 * Cria um registro em sync_runs (status running) e devolve helpers
 * para finalizar como success/failed.
 */
export async function startSyncRun(
  supabase: SupabaseClient,
  organizationId: string,
  accountId: string,
  resource: string
): Promise<{
  finishSuccess: (records: number, metadata?: Record<string, unknown>) => Promise<void>;
  finishFailed: (message: string) => Promise<void>;
}> {
  const { data } = await supabase
    .from("sync_runs")
    .insert({
      organization_id: organizationId,
      marketplace_account_id: accountId,
      provider: "mercadolivre",
      resource,
      status: "running",
      started_at: new Date().toISOString()
    })
    .select("id")
    .single();

  const runId = data?.id as string | undefined;

  return {
    async finishSuccess(records, metadata) {
      if (!runId) return;
      await supabase
        .from("sync_runs")
        .update({
          status: "success",
          finished_at: new Date().toISOString(),
          records_processed: records,
          metadata: metadata ?? {}
        })
        .eq("id", runId);
    },
    async finishFailed(message) {
      if (!runId) return;
      await supabase
        .from("sync_runs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          error_message: message
        })
        .eq("id", runId);
    }
  };
}
