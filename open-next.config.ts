import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import kvIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache";
import d1NextTagCache from "@opennextjs/cloudflare/overrides/tag-cache/d1-next-tag-cache";

/*
 * Cache do Next (unstable_cache, revalidateTag/revalidatePath).
 *
 * Sem isto a cache é "dummy": cada pedido recalculava tudo (vencimentos
 * no layout de TODAS as páginas, anuladas, mapa de comissões, ...).
 * - KV (NEXT_INC_CACHE_KV): os valores em cache.
 * - D1 (NEXT_TAG_CACHE_D1): quando cada tag/página foi invalidada; é
 *   consistente, por isso um revalidatePath depois de gravar vê-se logo.
 *   A tabela "revalidations" é criada pelo `opennextjs-cloudflare deploy`.
 */
export default defineCloudflareConfig({
  incrementalCache: kvIncrementalCache,
  tagCache: d1NextTagCache,
});
