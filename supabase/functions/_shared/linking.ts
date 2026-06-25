import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

/**
 * Garante que exista um product interno para um seller_sku e devolve o id.
 * Retorna null quando nao ha sku (sem como vincular de forma estavel).
 *
 * Mantem um cache em memoria por execucao para evitar consultas repetidas.
 */
export class ProductLinker {
  private cache = new Map<string, string>();

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly organizationId: string
  ) {}

  async resolve(sellerSku: string | null, title: string): Promise<string | null> {
    if (!sellerSku) return null;

    const cached = this.cache.get(sellerSku);
    if (cached) return cached;

    const { data: existing } = await this.supabase
      .from("products")
      .select("id")
      .eq("organization_id", this.organizationId)
      .eq("internal_sku", sellerSku)
      .maybeSingle();

    if (existing?.id) {
      this.cache.set(sellerSku, existing.id as string);
      return existing.id as string;
    }

    const { data: inserted, error } = await this.supabase
      .from("products")
      .insert({
        organization_id: this.organizationId,
        internal_sku: sellerSku,
        title: title || sellerSku
      })
      .select("id")
      .single();

    if (error || !inserted) {
      // Corrida: outra insercao pode ter criado. Tenta ler de novo.
      const { data: retry } = await this.supabase
        .from("products")
        .select("id")
        .eq("organization_id", this.organizationId)
        .eq("internal_sku", sellerSku)
        .maybeSingle();
      if (retry?.id) {
        this.cache.set(sellerSku, retry.id as string);
        return retry.id as string;
      }
      return null;
    }

    this.cache.set(sellerSku, inserted.id as string);
    return inserted.id as string;
  }

  /** Resolve o id de uma listing por external_item_id. */
  async resolveListing(
    accountId: string,
    externalItemId: string
  ): Promise<string | null> {
    const key = `listing:${externalItemId}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const { data } = await this.supabase
      .from("marketplace_listings")
      .select("id")
      .eq("marketplace_account_id", accountId)
      .eq("external_item_id", externalItemId)
      .maybeSingle();

    if (data?.id) {
      this.cache.set(key, data.id as string);
      return data.id as string;
    }
    return null;
  }
}
