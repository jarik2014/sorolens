import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
const QUERY = __ENV.QUERY || "load-test";

export const options = {
  vus: Number(__ENV.VUS || 10),
  duration: __ENV.DURATION || "30s",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500"],
  },
};

export default function () {
  // `q` is required by the spec; `limit` defaults to 10.
  const res = http.get(
    `${BASE_URL}/api/v1/search?q=${encodeURIComponent(QUERY)}&limit=10`
  );

  check(res, {
    "GET /api/v1/search is 200": (r) => r.status === 200,
    "search returns items[]": (r) => Array.isArray(r.json("items")),
  });

  sleep(1);
}
