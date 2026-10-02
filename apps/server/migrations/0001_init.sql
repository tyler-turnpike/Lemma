-- Lemma server schema v1. Applied by `npm run migrate -w @lemma/server`.
-- Identifiers are 0x-prefixed lowercase 32-byte hex; addresses are EIP-55 checksummed.
-- Atomic USDC amounts are decimal strings (never floats).

CREATE TABLE previews (
  preview_id    text PRIMARY KEY CHECK (preview_id ~ '^0x[0-9a-f]{64}$'),
  decision      text NOT NULL CHECK (decision IN ('reuse', 'adapt', 'build', 'decline')),
  release       text,
  release_id    text CHECK (release_id IS NULL OR release_id ~ '^0x[0-9a-f]{64}$'),
  price_atomic  text CHECK (price_atomic IS NULL OR price_atomic ~ '^(0|[1-9][0-9]{0,30})$'),
  purchasable   boolean NOT NULL,
  preview       jsonb NOT NULL,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL
);

CREATE TABLE resolutions (
  resolution_id   text PRIMARY KEY CHECK (resolution_id ~ '^0x[0-9a-f]{64}$'),
  preview_id      text NOT NULL REFERENCES previews (preview_id),
  buyer           text NOT NULL CHECK (buyer ~ '^0x[0-9a-fA-F]{40}$'),
  release         text NOT NULL,
  release_id      text NOT NULL CHECK (release_id ~ '^0x[0-9a-f]{64}$'),
  price_atomic    text NOT NULL CHECK (price_atomic ~ '^(0|[1-9][0-9]{0,30})$'),
  status          text NOT NULL CHECK (status IN ('pending', 'settled')),
  payment_hash    text UNIQUE CHECK (payment_hash IS NULL OR payment_hash ~ '^0x[0-9a-f]{64}$'),
  payload_digest  text CHECK (payload_digest IS NULL OR payload_digest ~ '^0x[0-9a-f]{64}$'),
  resolution      jsonb,
  created_at      timestamptz NOT NULL,
  settled_at      timestamptz,
  CONSTRAINT resolutions_preview_buyer_unique UNIQUE (preview_id, buyer),
  CONSTRAINT resolutions_settled_complete CHECK (
    status = 'pending' OR (payment_hash IS NOT NULL AND payload_digest IS NOT NULL AND resolution IS NOT NULL AND settled_at IS NOT NULL)
  )
);

CREATE TABLE settlements (
  tx_hash        text PRIMARY KEY CHECK (tx_hash ~ '^0x[0-9a-f]{64}$'),
  resolution_id  text NOT NULL UNIQUE REFERENCES resolutions (resolution_id),
  network        text NOT NULL,
  payer          text NOT NULL CHECK (payer ~ '^0x[0-9a-fA-F]{40}$'),
  amount_atomic  text NOT NULL CHECK (amount_atomic ~ '^(0|[1-9][0-9]{0,30})$'),
  settled_at     timestamptz NOT NULL
);

CREATE TABLE vouchers (
  resolution_id  text PRIMARY KEY REFERENCES resolutions (resolution_id),
  signer         text NOT NULL,
  signature      text NOT NULL,
  voucher        jsonb NOT NULL,
  created_at     timestamptz NOT NULL
);

CREATE TABLE adoption_receipts (
  receipt_id     text PRIMARY KEY CHECK (receipt_id ~ '^0x[0-9a-f]{64}$'),
  resolution_id  text NOT NULL REFERENCES resolutions (resolution_id),
  buyer          text NOT NULL,
  outcome        text NOT NULL CHECK (outcome IN ('passed', 'failed', 'abandoned')),
  digest         text NOT NULL UNIQUE CHECK (digest ~ '^0x[0-9a-f]{64}$'),
  signed         jsonb NOT NULL,
  created_at     timestamptz NOT NULL
);
CREATE INDEX adoption_receipts_resolution_idx ON adoption_receipts (resolution_id, created_at);

-- Indexer cursor (projection of registry events is idempotent by chain id, tx hash, log index).
CREATE TABLE chain_event_cursors (
  chain_id      integer NOT NULL,
  stream        text NOT NULL,
  block_number  bigint NOT NULL,
  log_index     integer NOT NULL,
  updated_at    timestamptz NOT NULL,
  PRIMARY KEY (chain_id, stream)
);
