-- VP-184 AC5: payments scheduled to a replaced bank account are held for Finance review.

ALTER TABLE payments DROP CONSTRAINT payments_status_check;
ALTER TABLE payments
  ADD CONSTRAINT payments_status_check CHECK (status IN ('scheduled', 'on_hold', 'released', 'cancelled'));

ALTER TABLE payments
  ADD COLUMN hold_reason  TEXT,
  ADD COLUMN hold_ref     TEXT REFERENCES bank_change_requests(id),
  ADD COLUMN held_at      TIMESTAMPTZ,
  ADD COLUMN resolution   TEXT CHECK (resolution IN ('redirected', 'cancelled')),
  ADD COLUMN resolved_by  TEXT,
  ADD COLUMN resolved_at  TIMESTAMPTZ;
