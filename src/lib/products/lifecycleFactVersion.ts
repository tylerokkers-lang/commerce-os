/**
 * The version stamped onto every persisted profitability verdict
 * (`profitability_records.engine_version`), so a stored verdict can always
 * be traced to the calculation that produced it — the same purpose
 * `product_intelligence.engine_version` and
 * `compliance_records.ruleset_version` already serve for their own facts.
 *
 * Its own tiny module purely so it carries no `server-only` import and can
 * be read by pure tests and by the persisted-fact writer alike.
 */
export const ENGINE_VERSION = 'profitability-gate@1'
