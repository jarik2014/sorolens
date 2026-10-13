import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
const LIMIT = Number(__ENV.LIMIT || 50);

export const options = {
  vus: Number(__ENV.VUS || 10),
  duration: __ENV.DURATION || "30s",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500"],
    "http_req_duration{kind:list}": ["p(95)<500"],
    "http_req_duration{kind:failed_only}": ["p(95)<500"],
  },
};

export default function () {
  const list = http.get(`${BASE_URL}/api/v1/invocations?limit=${LIMIT}`, {
    tags: { kind: "list" },
  });
  check(list, {
    "GET /api/v1/invocations is 200": (r) => r.status === 200,
    "invocations feed returns invocations[]": (r) => Array.isArray(r.json("invocations")),
    "invocations feed returns next_cursor": (r) =>
      typeof r.json("next_cursor") === "string",
  });

  // The status filter is a separate, index-backed query shape, so it is worth
  // exercising on every iteration.
  const failed = http.get(`${BASE_URL}/api/v1/invocations?status=FAILED&limit=20`, {
    tags: { kind: "failed_only" },
  });
  check(failed, {
    "filtered invocations is 200": (r) => r.status === 200,
    "filtered feed returns invocations[]": (r) => Array.isArray(r.json("invocations")),
  });

  sleep(1);
}
