# Branch plan: PR #482 (VP-184 bank change)

`main` (this repository) is the baseline. The next step builds the change that QIVVRA will assure.

| Item | Value |
|---|---|
| Branch | `feature/VP-184-bank-change` |
| PR | #482 "VP-184: Let Procurement change a supplier's bank account" |
| Target | `main` |
| Jira | VP-184 (story), VP-170 (epic) |

## Planned commits

1. **Commit 1 (built; the QIVVRA prototype calls it 8e7c4b1)** "VP-184: bank-change request and approval"
   - New table `bank_change_requests` (requested_by, decided_by, status) and migration `002`.
   - `POST /api/suppliers/:id/bank-change-requests` (PROCUREMENT, FINANCE_APPROVER), `POST /api/bank-change-requests/:id/approve` and `/reject` (FINANCE_APPROVER).
   - UI: change form and history on the supplier page, plus a Bank changes queue.
   - On approval the new account becomes active and the old one inactive.
   - **Defect 1 (intentional):** the approver is not checked against the requester. Finance Approvers can also raise changes, so one approver can request and approve their own change.
   - **Defect 2 (intentional, from the silent story):** payments already scheduled to the old account (PAY-7821) are left pointing at it, with no review or notice.
   - Team tests cover all four written acceptance criteria and pass (25/25). See `pr-482-demo.md`.

2. **Commit 2 (built; the QIVVRA prototype calls it c41d9e2)** "VP-184: block self-approval of bank changes"
   - Approval by the requester returns 403 `SELF_APPROVAL_NOT_ALLOWED`; the UI hides Approve on your own request.
   - New team test: "VP-184 the requester cannot approve their own bank change" (26/26 pass).
   - Scheduled payments are still left on the old account, so QIVVRA reports FIN-002 VIOLATED and the PR stays NOT READY.

3. **Commit 3 (built)** "VP-184: hold scheduled payments on bank change"
   - Product owner adds AC5 to VP-184 after QIVVRA's report.
   - Migration `003`: payments get `on_hold` and `cancelled` states, hold reason and resolution fields.
   - Approval holds payments still scheduled to the old account; release returns 409 `PAYMENT_ON_HOLD`.
   - `POST /api/payments/:id/resolve-hold` (`redirect` or `cancel`) by a Finance Approver other than the bank change requester.
   - Three new team tests (29/29 pass). QIVVRA: every obligation SUPPORTED, so the PR is READY.

## Expected QIVVRA results

| Obligation | Commit 1 | Commit 2 | Commit 3 |
|---|---|---|---|
| FIN-001.1 requester cannot approve | VIOLATED | SUPPORTED | SUPPORTED |
| FIN-002.1 scheduled payments held | VIOLATED | VIOLATED | SUPPORTED |
| FIN-002.3 held payment visible with reason | VIOLATED | VIOLATED | SUPPORTED |
| SEC-001 masking, CMP-001 audit, PLT-001 QE commit, FIN-003 release | SUPPORTED | SUPPORTED | SUPPORTED |
| Disposition | NOT READY | NOT READY | READY |

These are expected results. They become measured results once the qivvra-verifiers repository runs V1–V5 against each commit.
