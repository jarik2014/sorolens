-- tests/load/seed.sql
--
-- Seeds the load-test dataset: one contract, :n events and :i invocations.
-- Run it against a database whose migrations are already applied:
--
--   psql "$DB_URL" -v n=1000000 -v i=100000 -f tests/load/seed.sql
--
-- The CI smoke job uses a much smaller dataset (n=20000, i=2000).
--
-- Notes for readers:
--   * events is partitioned by RANGE (ledger_closed_at) and the migrations only
--     create the current and next month, so every synthetic timestamp is placed
--     inside the current month (`date_trunc('month', NOW()) + ...`) instead of
--     "now minus N days", which could fall outside the existing partitions.
--   * contract ids are shaped like Stellar StrKeys (56 characters starting with
--     "C") so that contract-id prefix filters behave like they do in production.
--   * every value is derived from the row number, so a re-run of the same size
--     produces the same rows and the inserts can be repeated safely.

\if :{?n}
\else
\set n 10000
\endif

\if :{?i}
\else
\set i 1000
\endif

BEGIN;

-- One contract for the whole dataset; the events/invocations foreign keys point
-- at it. Two md5 digests give 64 hex characters, of which we keep 55.
INSERT INTO contracts (id, network, label, status)
VALUES (
  'C' || upper(substr(md5('sorolens-load-seed') || md5('contract'), 1, 55)),
  'testnet',
  'load-test contract',
  'active'
)
ON CONFLICT (id) DO NOTHING;

-- Two more contracts so /api/v1/search?q= has something to match.
INSERT INTO contracts (id, network, label, status)
VALUES
  ('C' || upper(substr(md5('sorolens-load-seed') || md5('contract-2'), 1, 55)),
   'testnet', 'load-test contract two', 'active'),
  ('C' || upper(substr(md5('sorolens-load-seed') || md5('contract-3'), 1, 55)),
   'testnet', 'load-test contract three', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO events (
  id, contract_id, ledger, ledger_closed_at, tx_hash, type,
  topic_xdr, value_xdr, topic_decoded, value_decoded, in_successful_call
)
SELECT
  'evt-' || lpad(g::text, 12, '0'),
  'C' || upper(substr(md5('sorolens-load-seed') || md5('contract'), 1, 55)),
  1000000 + (g % 100000),
  date_trunc('month', NOW()) + ((g % 3600) || ' seconds')::interval,
  'tx-' || lpad((g % 1000000)::text, 12, '0'),
  CASE WHEN g % 50 = 0 THEN 'system' ELSE 'contract' END,
  jsonb_build_array('transfer', 'G' || upper(substr(md5(g::text), 1, 20))),
  'AAAA',
  jsonb_build_array('transfer', 'amount'),
  jsonb_build_object('amount', (g % 1000)::text),
  (g % 20) <> 0
FROM generate_series(1, :n) AS g
ON CONFLICT DO NOTHING;

INSERT INTO invocations (
  tx_hash, contract_id, ledger, ledger_closed_at, status, function_name,
  args_decoded, result_decoded, resource_fee_charged, cpu_insn, mem_byte,
  ledger_read_byte, ledger_write_byte, application_order
)
SELECT
  'inv-' || lpad(g::text, 12, '0'),
  'C' || upper(substr(md5('sorolens-load-seed') || md5('contract'), 1, 55)),
  1000000 + (g % 100000),
  date_trunc('month', NOW()) + ((g % 3600) || ' seconds')::interval,
  CASE WHEN g % 10 = 0 THEN 'FAILED' ELSE 'SUCCESS' END,
  CASE WHEN g % 3 = 0 THEN 'transfer' ELSE 'mint' END,
  jsonb_build_object('to', 'G' || upper(substr(md5(g::text), 1, 20))),
  jsonb_build_object('ok', (g % 10) <> 0),
  100 + (g % 5000),
  1000 + (g % 500000),
  200 + (g % 20000),
  64 + (g % 4096),
  32 + (g % 2048),
  g % 8
FROM generate_series(1, :i) AS g
ON CONFLICT DO NOTHING;

COMMIT;

ANALYZE events;
ANALYZE invocations;
ANALYZE contracts;
