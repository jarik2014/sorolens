#!/usr/bin/env node
/**
 * Generates the playground's endpoint list from docs/openapi.yaml.
 *
 * The playground used to read apps/web/lib/openapi.ts — a hand-written copy of
 * roughly a third of the API surface, which silently drifted. This script turns
 * the published spec into apps/web/lib/openapi.generated.ts instead, and
 * `--check` fails when the committed file no longer matches the spec (CI runs it
 * as a drift gate).
 *
 * Usage:
 *   node scripts/generate-openapi-operations.mjs          # write the file
 *   node scripts/generate-openapi-operations.mjs --check  # fail if it is stale
 *
 * Deliberate omissions, so a reviewer sees them:
 *   - header/cookie parameters are dropped: the playground form renders path and
 *     query arguments only, and putting header names into the query string would
 *     be worse than leaving them out;
 *   - `$ref`s are resolved up to 10 levels deep, which covers the spec's
 *     components/parameters and components/schemas indirection.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const repoRoot = path.resolve(webRoot, "..", "..");

export const SPEC_PATH = path.join(repoRoot, "docs", "openapi.yaml");
export const OUT_PATH = path.join(webRoot, "lib", "openapi.generated.ts");

const METHODS = ["get", "post", "put", "patch", "delete"];
const MAX_DEPTH = 10;

function resolvePointer(doc, pointer) {
  if (typeof pointer !== "string" || !pointer.startsWith("#/"))
    return undefined;
  return pointer
    .slice(2)
    .split("/")
    .reduce((node, key) => (node == null ? node : node[key]), doc);
}

/** Follows `$ref` chains; returns the node itself when it is not a reference. */
function deref(doc, node, depth = 0) {
  let current = node;
  let hops = 0;
  while (current && typeof current === "object" && "$ref" in current) {
    if (hops++ > MAX_DEPTH) return undefined;
    current = resolvePointer(doc, current.$ref);
  }
  if (depth > 0) return current;
  return current ?? node;
}

/** Deterministic placeholder for a schema property with no example/enum/default. */
function placeholderFor(schema) {
  switch (schema?.type) {
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return false;
    case "array":
      return [];
    case "object":
      return {};
    default:
      return "<string>";
  }
}

const TYPE_NAMES = new Set(["string", "integer", "number", "boolean"]);

function scalarTypeOf(schema) {
  const type = schema?.type;
  return TYPE_NAMES.has(type) ? type : undefined;
}

/** Best-effort example value for a schema, used to prefill the playground body. */
function exampleForSchema(doc, schema, depth = 0) {
  const resolved = deref(doc, schema);
  if (!resolved || typeof resolved !== "object" || depth > MAX_DEPTH) {
    return placeholderFor(resolved);
  }
  if (resolved.example !== undefined) return resolved.example;
  if (resolved.default !== undefined) return resolved.default;
  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) {
    return resolved.enum[0];
  }
  if (resolved.type === "object" && resolved.properties) {
    const out = {};
    const required = new Set(resolved.required ?? []);
    for (const [name, property] of Object.entries(resolved.properties)) {
      // Only required properties get a placeholder body; anything optional would
      // make the prefilled request longer than the docs example.
      if (required.has(name) || property?.example !== undefined) {
        out[name] = exampleForSchema(doc, property, depth + 1);
      }
    }
    return out;
  }
  if (resolved.type === "array" && resolved.items) {
    return [exampleForSchema(doc, resolved.items, depth + 1)];
  }
  if (resolved.oneOf || resolved.anyOf) {
    const first = (resolved.oneOf ?? resolved.anyOf)[0];
    return exampleForSchema(doc, first, depth + 1);
  }
  return placeholderFor(resolved);
}

function parameterFrom(doc, raw) {
  const resolved = deref(doc, raw);
  if (!resolved || typeof resolved !== "object" || !resolved.name)
    return undefined;
  if (resolved.in !== "path" && resolved.in !== "query") return undefined;

  const schema = deref(doc, resolved.schema);
  const parameter = {
    name: resolved.name,
    in: resolved.in,
    required: resolved.in === "path" ? true : Boolean(resolved.required),
    description: resolved.description ?? schema?.description,
    type: scalarTypeOf(schema),
  };
  const fallback = schema?.default ?? resolved.example;
  if (fallback !== undefined) parameter.default = String(fallback);
  return parameter;
}

/** Example body: the spec's example when present, else JSON built from the schema. */
function requestBodyFrom(doc, raw) {
  const resolved = deref(doc, raw);
  const content = resolved?.content;
  if (!content) return undefined;

  const media =
    content["application/json"] ??
    Object.values(content).find((entry) => entry && entry.schema);
  if (!media) return undefined;

  const explicit = media.example ?? deref(doc, media.schema)?.example;
  const value =
    explicit !== undefined ? explicit : exampleForSchema(doc, media.schema);
  if (value === undefined) return undefined;

  return {
    description: resolved.description ?? deref(doc, media.schema)?.description,
    example: JSON.stringify(value, null, 2),
  };
}

function operationFrom(doc, path_, method, raw) {
  const resolved = deref(doc, raw);
  const parameters = [];

  for (const candidate of [
    ...(doc.paths[path_]?.parameters ?? []),
    ...(resolved?.parameters ?? []),
  ]) {
    const parameter = parameterFrom(doc, candidate);
    if (
      parameter &&
      !parameters.some(
        (p) => p.name === parameter.name && p.in === parameter.in
      )
    ) {
      parameters.push(parameter);
    }
  }

  const operation = {
    operationId:
      resolved?.operationId ??
      `${method}${path_.replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ?? "").toUpperCase())}`,
    summary:
      resolved?.summary ??
      resolved?.description?.split("\n")[0]?.trim() ??
      `${method.toUpperCase()} ${path_}`,
    tags:
      Array.isArray(resolved?.tags) && resolved.tags.length > 0
        ? resolved.tags
        : ["Other"],
    parameters,
  };

  const body = requestBodyFrom(doc, resolved?.requestBody);
  if (body) operation.requestBody = body;
  return operation;
}

/** Builds the OpenAPI-shaped document the web app consumes. */
export function buildDocument(spec) {
  const paths = {};
  for (const [path_, rawItem] of Object.entries(spec.paths ?? {})) {
    const item = {};
    for (const method of METHODS) {
      if (rawItem?.[method])
        item[method] = operationFrom(spec, path_, method, rawItem[method]);
    }
    if (Object.keys(item).length > 0) paths[path_] = item;
  }

  return {
    openapi: spec.openapi ?? "3.0.0",
    info: {
      title: spec.info?.title ?? "Sorolens API",
      version: spec.info?.version ?? "0.0.0",
    },
    paths,
  };
}

export function countOperations(document) {
  return Object.values(document.paths).reduce(
    (total, item) => total + METHODS.filter((method) => item[method]).length,
    0
  );
}

function render(document) {
  const operations = countOperations(document);
  return `// Generated by scripts/generate-openapi-operations.mjs from docs/openapi.yaml.
// Do not edit by hand: run \`pnpm --filter @sorolens/web gen:openapi\` instead,
// and let the "Playground endpoint list up-to-date" CI job catch drift.
//
// ${operations} operations across ${Object.keys(document.paths).length} paths.
// Header and cookie parameters are intentionally not included — the playground
// form sends path and query arguments only.

import type { OpenAPIDocument } from "./openapi-types";

export const GENERATED_OPERATION_COUNT = ${operations};
export const GENERATED_PATH_COUNT = ${Object.keys(document.paths).length};

export const generatedOpenApiDocument: OpenAPIDocument = ${JSON.stringify(document, null, 2)};
`;
}

function main() {
  const spec = parse(readFileSync(SPEC_PATH, "utf8"));
  const document = buildDocument(spec);
  const text = render(document);

  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(OUT_PATH, "utf8");
    } catch {
      console.error(
        `${path.relative(process.cwd(), OUT_PATH)} is missing — run gen:openapi`
      );
      process.exit(1);
    }
    if (current !== text) {
      console.error(
        "apps/web/lib/openapi.generated.ts is out of date with docs/openapi.yaml — run `pnpm --filter @sorolens/web gen:openapi`"
      );
      process.exit(1);
    }
    console.log("openapi.generated.ts matches docs/openapi.yaml");
    return;
  }

  writeFileSync(OUT_PATH, text);
  console.log(
    `wrote ${path.relative(process.cwd(), OUT_PATH)}: ${countOperations(document)} operations`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
