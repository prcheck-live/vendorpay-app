-- VendorPay baseline schema (main).
-- Supplier bank accounts are stored in full and must only ever leave the service masked (VP-182).

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('FINANCE_OPS', 'FINANCE_APPROVER', 'PROCUREMENT', 'AUDITOR')),
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SEQUENCE supplier_seq START 192;
CREATE TABLE suppliers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('pending_verification', 'active')),
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE supplier_bank_accounts (
  id              SERIAL PRIMARY KEY,
  supplier_id     TEXT NOT NULL REFERENCES suppliers(id),
  account_number  TEXT NOT NULL,
  ifsc            TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('pending', 'active')),
  created_by      TEXT NOT NULL,
  verified_by     TEXT,
  verified_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_active_account_per_supplier ON supplier_bank_accounts (supplier_id) WHERE status = 'active';

CREATE SEQUENCE payment_seq START 7790;
CREATE TABLE payments (
  id                      TEXT PRIMARY KEY,
  supplier_id             TEXT NOT NULL REFERENCES suppliers(id),
  amount_minor            BIGINT NOT NULL CHECK (amount_minor > 0),
  currency                TEXT NOT NULL DEFAULT 'INR',
  -- The destination is fixed when the payment instruction is created.
  destination_account_id  INTEGER NOT NULL REFERENCES supplier_bank_accounts(id),
  status                  TEXT NOT NULL CHECK (status IN ('scheduled', 'released')),
  scheduled_for           DATE NOT NULL,
  created_by              TEXT NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_by             TEXT,
  released_at             TIMESTAMPTZ
);

CREATE TABLE audit_events (
  id           BIGSERIAL PRIMARY KEY,
  type         TEXT NOT NULL,
  actor        TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  details      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_entity ON audit_events (entity_type, entity_id);
