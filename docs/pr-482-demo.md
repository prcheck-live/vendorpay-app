# PR #482 demo: three commits, green tests every time

Branch `feature/VP-184-bank-change`. The team's own tests pass on every commit. Only QIVVRA, assuring against the policy repository, tells the commits apart.

| | Commit 1 | Commit 2 | Commit 3 |
|---|---|---|---|
| Message | bank-change request and approval | block self-approval of bank changes | hold scheduled payments on bank change |
| QIVVRA prototype calls it | 8e7c4b1 | c41d9e2 | — |
| Team tests | 25/25 pass | 26/26 pass | 29/29 pass |
| FIN-001.1 requester cannot approve | **VIOLATED** | SUPPORTED | SUPPORTED |
| FIN-002.1 scheduled payments held | **VIOLATED** | **VIOLATED** | SUPPORTED |
| FIN-002.2 no silent redirect | SUPPORTED | SUPPORTED | SUPPORTED |
| FIN-002.3 held payment visible with reason | **VIOLATED** | **VIOLATED** | SUPPORTED |
| Other obligations (masking, audit, QE commit, release rules) | SUPPORTED | SUPPORTED | SUPPORTED |
| Disposition | **NOT READY** | **NOT READY** | **READY** |

Why FIN-002 is VIOLATED and not INSUFFICIENT: QIVVRA's V3 verifier actively tests it. It approves a bank change and then tries to release PAY-7821. The release succeeds and the payment still goes to the replaced account, which is positive evidence of a breach. INSUFFICIENT would mean there is no evidence either way. A VIOLATED obligation cannot be waived by an exception, so commit 2 has no route to READY WITH EXCEPTIONS.

FIN-002.2 counts as SUPPORTED on commits 1 and 2 because nothing redirects the payment; it simply stays on the old account, which is the FIN-002.1 failure.

The commit hashes are in `git log`. To see a commit, run `git checkout <hash> && npm run build && npm run db:reset` and restart the app.

## Commit 1: two defects

**Defect 1, self-approval.** Finance Approvers may raise bank changes ("when a supplier calls Finance directly"), and approval never compares approver with requester.

```bash
T=$(curl -s localhost:3000/api/auth/login -H 'content-type: application/json' \
  -d '{"username":"m.fernandes","password":"VendorPay@2026"}' | jq -r .token)
ID=$(curl -s localhost:3000/api/suppliers/SUP-0192/bank-change-requests \
  -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"accountNumber":"918020077665588","ifsc":"UTIB0000918","reason":"Supplier emailed new bank details"}' | jq -r .request.id)
curl -s -X POST localhost:3000/api/bank-change-requests/$ID/approve -H "authorization: Bearer $T" | jq .request
# commit 1: 200, requestedBy = decidedBy = m.fernandes
# commits 2 and 3: 403 SELF_APPROVAL_NOT_ALLOWED
```

**Defect 2, scheduled payment left on the old account.** VP-184 as first written says nothing about scheduled payments.

```bash
curl -s localhost:3000/api/payments/PAY-7821 -H "authorization: Bearer $T" | jq .payment
# commits 1 and 2: status "scheduled", destination "**** 4421" (now inactive), releasable
# commit 3: status "on_hold", reason "Supplier bank account changed (BCR-…)"
```

On commits 2 and 3, use a second approver to approve (log in as `j.thomas`).

## Commit 2: the fix the team knew about

Self-approval returns 403 and the UI shows "Needs another approver". The team added a test for it. PAY-7821 still goes to the inactive account, and all 26 team tests are green, because the story never asked for anything else.

## Commit 3: the fix QIVVRA forced

The product owner added AC5 to VP-184 after QIVVRA reported FIN-002 VIOLATED on commit 2.

- Approving a bank change puts every payment still scheduled to the old account `on_hold`, with the reason and the bank change ID. The approve response lists them in `heldPayments`.
- A held payment cannot be released (409 `PAYMENT_ON_HOLD`).
- A Finance Approver chooses **Pay new account** (`resolve-hold` with `redirect`) or **Cancel**. The person who requested the bank change cannot decide (403 `SELF_RESOLUTION_NOT_ALLOWED`).
- Holding and resolving are both audited (`PAYMENT_HELD`, `PAYMENT_HOLD_RESOLVED`).
- Payments to other suppliers, and payments already released, are untouched.

In the UI: sign in as `m.fernandes` and request a change for Northstar Components. Sign in as `j.thomas` and approve it. PAY-7821 shows **on hold** with Pay new account and Cancel.

## Reset the demo data

```bash
npm run db:reset          # or: docker compose down -v && docker compose up --build
```
