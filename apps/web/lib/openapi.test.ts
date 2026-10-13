import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { endpointsByTag, listEndpoints, openApiDocument } from "./openapi";

const webRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const specPath = path.resolve(webRoot, "..", "..", "docs", "openapi.yaml");
const METHODS = ["get", "post", "put", "patch", "delete"] as const;

function operationsFromSpec() {
  const spec = parse(readFileSync(specPath, "utf8"));
  const out: string[] = [];
  for (const [endpointPath, item] of Object.entries(spec.paths ?? {})) {
    for (const method of METHODS) {
      if ((item as Record<string, unknown> | undefined)?.[method]) {
        out.push(`${method.toUpperCase()} ${endpointPath}`);
      }
    }
  }
  return out;
}

describe("OpenAPI endpoint list", () => {
  it("is not stale compared with docs/openapi.yaml", () => {
    expect(() =>
      execFileSync(
        "node",
        ["scripts/generate-openapi-operations.mjs", "--check"],
        {
          cwd: webRoot,
          stdio: "pipe",
        }
      )
    ).not.toThrow();
  });

  it("contains every operation the spec declares, and nothing extra", () => {
    const expected = operationsFromSpec().sort();
    const actual = listEndpoints()
      .map((entry) => `${entry.method} ${entry.path}`)
      .sort();
    expect(actual).toEqual(expected);
    expect(actual.length).toBeGreaterThan(50);
  });

  it("keeps every path and operation unique", () => {
    const keys = listEndpoints().map(
      (entry) => `${entry.method} ${entry.path}`
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(Object.keys(openApiDocument.paths).length).toBeGreaterThan(0);
  });

  it("marks path parameters as required and keeps only path/query parameters", () => {
    for (const entry of listEndpoints()) {
      for (const parameter of entry.operation.parameters) {
        expect(["path", "query"]).toContain(parameter.in);
        if (parameter.in === "path") {
          expect(
            parameter.required,
            `${entry.method} ${entry.path} ${parameter.name}`
          ).toBe(true);
        }
      }
    }
  });

  it("groups every operation under a tag without losing any", () => {
    const groups = endpointsByTag();
    const total = groups.reduce(
      (sum, group) => sum + group.endpoints.length,
      0
    );
    expect(total).toBe(listEndpoints().length);
    for (const group of groups) {
      expect(group.tag.length).toBeGreaterThan(0);
      expect(group.endpoints.length).toBeGreaterThan(0);
    }
  });

  it("gives every operation a summary and an operationId", () => {
    for (const { method, path: endpointPath, operation } of listEndpoints()) {
      expect(operation.summary, `${method} ${endpointPath}`).toBeTruthy();
      expect(operation.operationId, `${method} ${endpointPath}`).toBeTruthy();
    }
  });
});
