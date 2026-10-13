import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
const LIMIT = Number(__ENV.LIMIT || 50);

// Tracked separately from http_req_duration so the paging leg can be watched on
// its own while the smoke run is short.
const pageLatency = new Trend("events_page_duration", true);

export const options = {
  vus: Number(__ENV.VUS || 10),
  duration: __ENV.DURATION || "30s",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500"],
    events_page_duration: ["p(95)<500"],
  },
};

export default function () {
  // Newest events across every tracked contract (live feed).
  const recent = http.get(`${BASE_URL}/api/v1/events/recent?limit=20`);
  check(recent, {
    "GET /api/v1/events/recent is 200": (r) => r.status === 200,
    "recent feed returns events[]": (r) => Array.isArray(r.json("events")),
  });

  // Cross-contract explorer feed, one page plus one cursor page.
  const first = http.get(`${BASE_URL}/api/v1/events?limit=${LIMIT}`);
  pageLatency.add(first.timings.duration);
  check(first, {
    "GET /api/v1/events is 200": (r) => r.status === 200,
    "events feed returns events[]": (r) => Array.isArray(r.json("events")),
    "events feed returns next_cursor": (r) => typeof r.json("next_cursor") === "string",
  });

  const cursor = first.status === 200 ? first.json("next_cursor") : "";
  if (cursor) {
    const next = http.get(
      `${BASE_URL}/api/v1/events?limit=${LIMIT}&cursor=${encodeURIComponent(cursor)}`
    );
    check(next, { "cursor page is 200": (r) => r.status === 200 });
  }

  sleep(1);
}
