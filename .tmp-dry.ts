import { syncZurichPolicies } from "@/lib/insurance/providers/zurich/sync";
(async () => {
  const t = Date.now();
  const r = (await syncZurichPolicies({ dryRun: true, enrichment: false })) as unknown as Record<string, unknown>;
  console.log("RES", JSON.stringify({ received: r.received, status: r.status, s: Math.round((Date.now() - t) / 1000) }));
})();
