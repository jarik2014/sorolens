/**
 * @sorolens/ts-sdk — typed access to the Sorolens API.
 *
 * The operation table and the schema types in `src/generated/` are produced by
 * `scripts/generate.mjs` from `docs/openapi.yaml`; the client core in
 * `src/client.ts` is hand-written. Regenerate with
 * `pnpm --filter @sorolens/ts-sdk gen`.
 */
export {
  SorolensClient,
  SorolensError,
  type ClientOptions,
  type RequestOptions,
  type Page,
} from "./client";
export {
  operations,
  operationIds,
  type Operation,
  type OperationId,
  type OperationParameter,
} from "./generated/operations";
export * from "./generated/types";
