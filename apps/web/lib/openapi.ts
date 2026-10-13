/**
 * The playground's endpoint list, generated from docs/openapi.yaml.
 *
 * The operations come from `lib/openapi.generated.ts`, which
 * `scripts/generate-openapi-operations.mjs` writes; the CI job "Playground
 * endpoint list up-to-date" fails when the committed file is stale, so this
 * module never has to be edited when the API grows.
 */
import type {
  EndpointEntry,
  HttpMethod,
  OpenAPIDocument,
  OpenAPIOperation,
  OpenAPIPathItem,
} from "./openapi-types";
import { generatedOpenApiDocument } from "./openapi.generated";

export * from "./openapi-types";

export const openApiDocument: OpenAPIDocument = generatedOpenApiDocument;

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function operationFor(
  item: OpenAPIPathItem,
  method: HttpMethod
): OpenAPIOperation | undefined {
  return item[method.toLowerCase() as Lowercase<HttpMethod>];
}

export function listEndpoints(
  doc: OpenAPIDocument = openApiDocument
): EndpointEntry[] {
  const out: EndpointEntry[] = [];
  for (const [endpointPath, item] of Object.entries(doc.paths)) {
    for (const method of METHODS) {
      const operation = operationFor(item, method);
      if (operation) out.push({ method, path: endpointPath, operation });
    }
  }
  return out;
}

export function endpointsByTag(
  doc: OpenAPIDocument = openApiDocument
): { tag: string; endpoints: EndpointEntry[] }[] {
  const groups = new Map<string, EndpointEntry[]>();
  for (const entry of listEndpoints(doc)) {
    const tag = entry.operation.tags[0] ?? "Other";
    const list = groups.get(tag) ?? [];
    list.push(entry);
    groups.set(tag, list);
  }
  return Array.from(groups, ([tag, endpoints]) => ({ tag, endpoints }));
}
