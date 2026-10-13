import { describe, expect, it, vi } from "vitest";
import { SorolensClient, SorolensError } from "../src/client";
import { operations } from "../src/generated/operations";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function clientWith(fetchImpl: typeof fetch, options = {}) {
  return new SorolensClient({
    baseUrl: "https://api.example.test",
    apiKey: "secret-key",
    fetch: fetchImpl,
    retryDelayMs: 1,
    ...options,
  });
}

describe("generated operation table", () => {
  it("covers the endpoints the SDK is expected to expose", () => {
    expect(Object.keys(operations).length).toBeGreaterThan(50);
    expect(operations.listContracts).toBeDefined();
    expect(operations.listContracts.path).toBe("/api/v1/contracts");
    expect(operations.listContracts.method).toBe("GET");
  });

  it("marks cursor-paginated list endpoints", () => {
    const client = clientWith(vi.fn() as unknown as typeof fetch);
    expect(client.supportsPagination("listContracts")).toBe(true);
    expect(client.supportsPagination("recentEvents")).toBe(false);
  });
});

describe("SorolensClient.url", () => {
  const client = clientWith(vi.fn() as unknown as typeof fetch);

  it("substitutes path parameters and encodes them", () => {
    expect(client.url("getContract", { pathParams: { id: "CABC/DEF" } })).toBe(
      "https://api.example.test/api/v1/contracts/CABC%2FDEF"
    );
  });

  it("keeps query values, drops empty ones and encodes them", () => {
    const url = client.url("listContracts", {
      query: { limit: 25, status: "active", cursor: undefined, network: "" },
    });
    expect(url).toBe("https://api.example.test/api/v1/contracts?limit=25&status=active");
  });

  it("fails loudly when a path parameter is missing", () => {
    expect(() => client.url("getContract")).toThrow(/Missing path parameter "id"/);
  });

  it("rejects an unknown operation id", () => {
    expect(() => client.url("nope" as never)).toThrow(/Unknown operation "nope"/);
  });
});

describe("SorolensClient.request", () => {
  it("sends the API key and parses JSON", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ contracts: [], next_cursor: "" }));
    const client = clientWith(fetchImpl as unknown as typeof fetch);

    await expect(client.request("listContracts")).resolves.toEqual({
      contracts: [],
      next_cursor: "",
    });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.test/api/v1/contracts");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret-key");
  });

  it("serialises a JSON body", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: "C1" }, 201));
    const client = clientWith(fetchImpl as unknown as typeof fetch);

    await client.request("registerContract", { body: { id: "C1", network: "testnet" } });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ id: "C1", network: "testnet" }));
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("retries a retryable status and then succeeds", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: "boom" }, 503))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const onRetry = vi.fn();
    const client = clientWith(fetchImpl, { onRetry, retries: 2 });

    await expect(client.request("listContracts")).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("gives up after the retry budget and throws SorolensError", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "unavailable" }, 503));
    const client = clientWith(fetchImpl as unknown as typeof fetch, { retries: 1 });

    await expect(client.request("listContracts")).rejects.toBeInstanceOf(SorolensError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry client errors", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "missing scope" }, 403));
    const client = clientWith(fetchImpl as unknown as typeof fetch, { retries: 3 });

    await expect(client.request("listContracts")).rejects.toMatchObject({
      status: 403,
      body: { error: "missing scope" },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries network failures", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(jsonResponse({ ok: 1 }));
    const client = clientWith(fetchImpl, { retries: 1 });

    await expect(client.request("listContracts")).resolves.toEqual({ ok: 1 });
  });
});

describe("SorolensClient.paginate", () => {
  it("follows next_cursor until it is empty", async () => {
    const pages = [
      { contracts: [{ id: "C1" }], next_cursor: "abc" },
      { contracts: [{ id: "C2" }], next_cursor: "" },
    ];
    const fetchImpl = vi.fn(async (url: string) => {
      const cursor = new URL(url).searchParams.get("cursor");
      return jsonResponse(cursor ? pages[1] : pages[0]);
    });
    const client = clientWith(fetchImpl as unknown as typeof fetch);

    const collected = [];
    for await (const page of client.paginate("listContracts")) {
      collected.push(...page);
    }

    expect(collected).toEqual([{ id: "C1" }, { id: "C2" }]);
    const secondUrl = fetchImpl.mock.calls[1][0] as string;
    expect(new URL(secondUrl).searchParams.get("cursor")).toBe("abc");
  });

  it("stops at maxPages", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ contracts: [{ id: "C1" }], next_cursor: "more" }));
    const client = clientWith(fetchImpl as unknown as typeof fetch);

    let calls = 0;
    for await (const page of client.paginate("listContracts", { maxPages: 3 })) {
      calls += page.length > 0 ? 1 : 0;
    }

    expect(calls).toBe(3);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("refuses endpoints that are not cursor-paginated", async () => {
    const client = clientWith(vi.fn() as unknown as typeof fetch);
    const iterator = client.paginate("recentEvents");

    await expect(iterator.next()).rejects.toThrow(/not cursor-paginated/);
  });
});
