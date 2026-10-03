-- Per-request quotes: the up-front price is the registered (warranty-covered) price; the rest of
-- the quote is a success fee paid after the acceptance tests pass. One fee per resolution.
CREATE TABLE success_fees (
  resolution_id  text PRIMARY KEY REFERENCES resolutions (resolution_id),
  buyer          text NOT NULL CHECK (buyer ~ '^0x[0-9a-fA-F]{40}$'),
  amount_atomic  text NOT NULL CHECK (amount_atomic ~ '^[1-9][0-9]{0,30}$'),
  tx_hash        text NOT NULL UNIQUE CHECK (tx_hash ~ '^0x[0-9a-f]{64}$'),
  network        text NOT NULL,
  settled_at     timestamptz NOT NULL
);

-- Buyers who reported a passed adoption without paying its success fee. Refused future sales.
CREATE TABLE delinquent_buyers (
  buyer          text PRIMARY KEY CHECK (buyer ~ '^0x[0-9a-fA-F]{40}$'),
  resolution_id  text NOT NULL REFERENCES resolutions (resolution_id),
  marked_at      timestamptz NOT NULL
);
