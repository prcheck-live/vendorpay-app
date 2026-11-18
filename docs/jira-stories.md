# VendorPay backlog (Jira project VP)

Import `jira-stories.csv` into Jira (System → External system import → CSV) to create these issues. Import `xray-tests.csv` with the Xray test-case importer to create the matching test cases.

## VP-170 Epic: VendorPay supplier payments

Baseline platform: sign-in, roles, `/health`, `/version` and log masking.

| Key | Type | Status | Summary |
|---|---|---|---|
| VP-181 | Story | Done | Onboard a supplier with a bank account that a second person verifies |
| VP-182 | Story | Done | Show bank account numbers masked everywhere |
| VP-183 | Story | Done | Schedule and release supplier payments with separation of duties |
| VP-185 | Story | Done | Record an audit trail of every change |
| VP-184 | Story | In Review (PR #482, commit 3) | Let Procurement change a supplier's bank account |

## Done stories (on `main`)

### VP-181 Onboard a supplier with a bank account that a second person verifies
As Procurement, I want to onboard a supplier with their bank account so Finance can pay them.

- Only PROCUREMENT can create suppliers.
- Account number is 9–18 digits; IFSC matches `^[A-Z]{4}0[A-Z0-9]{6}$`. Invalid input returns 422 with a field message.
- A new supplier is `pending` until a FINANCE_APPROVER verifies the bank account. Then it becomes `active`.
- The person who added the account cannot verify it (`SELF_VERIFICATION_NOT_ALLOWED`).

### VP-182 Show bank account numbers masked everywhere
As Finance, I want bank account numbers hidden so they cannot leak through screens, exports or logs.

- UI and API show only the last four digits (`**** 4421`).
- Application logs replace any 9–18 digit number with `**** last4`.

### VP-183 Schedule and release supplier payments with separation of duties
- Only FINANCE_OPS can schedule; only active suppliers can be paid (`SUPPLIER_NOT_ACTIVE`).
- Amount is positive with at most two decimals; date is today or later.
- The destination account is the supplier's active account at the moment the payment is created and does not change afterwards.
- Only FINANCE_APPROVER can release; not the person who scheduled it (`SELF_RELEASE_NOT_ALLOWED`); a payment is released once.

### VP-185 Record an audit trail of every change
- Onboarding, verification, scheduling and release each write an audit event with actor, entity and details.
- Audit details never contain a full account number.
- AUDITOR and FINANCE_APPROVER can read the trail; others get 403.

## Upcoming story (PR #482)

### VP-184 Let Procurement change a supplier's bank account
As Procurement, I want to change a supplier's bank account when they move banks, so future payments reach them.

Acceptance criteria as first written (PR #482 commits 1 and 2 were built against these):
1. Procurement can submit a new bank account for an active supplier.
2. The new account must be approved by a Finance Approver before it becomes active.
3. The new account number is masked in the UI and API.
4. The change is recorded in the audit trail.

The story was silent on two things the policy repository requires:
- FIN-001: the approver must be a different person from the requester. Commit 1 let one Finance Approver request and approve their own change. Commit 2 fixed it (`SELF_APPROVAL_NOT_ALLOWED`).
- FIN-002: payments already scheduled to the old account must be held. Commits 1 and 2 left PAY-7821 (INR 8,50,000, due 2026-11-05) pointing at the replaced account.

Added by the product owner after QIVVRA reported FIN-002 VIOLATED on commit 2:
5. When a bank change is approved, payments still scheduled to the old account are put on hold for Finance review. A Finance Approver who did not request the change redirects each held payment to the new account or cancels it. Held payments cannot be released.

Commit 3 implements AC5.

## Xray tests (team suite)

| Test | Covers |
|---|---|
| VP-170 a demo user can sign in and read their own profile | VP-170 |
| VP-170 a wrong password is rejected without saying which field was wrong | VP-170 |
| VP-170 API calls without a token are refused | VP-170 |
| VP-170 the build reports its commit for environment checks | VP-170 |
| VP-181 Procurement onboards a supplier whose bank account waits for verification | VP-181 |
| VP-181 Finance Ops cannot onboard suppliers | VP-181 |
| VP-181 an invalid IFSC code is rejected with a field message | VP-181 |
| VP-181 a Finance Approver verifies the account and the supplier becomes active | VP-181 |
| VP-182 supplier responses show only the last four digits of the account | VP-182 |
| VP-182 the supplier list never contains a full account number | VP-182 |
| VP-182 a Finance Ops user signs in and sees suppliers with masked accounts (UI) | VP-182 |
| VP-183 Finance Ops schedules a payment to the supplier's active account | VP-183 |
| VP-183 payments cannot be scheduled for a supplier awaiting verification | VP-183 |
| VP-183 Procurement cannot schedule payments | VP-183 |
| VP-183 a past date is rejected | VP-183 |
| VP-183 a Finance Approver releases a scheduled payment once | VP-183 |
| VP-183 Finance Ops cannot release payments | VP-183 |
| VP-184 Procurement submits a new bank account for an active supplier | VP-184 |
| VP-184 the new account stays inactive until a Finance Approver approves it | VP-184 |
| VP-184 Procurement cannot approve a bank change | VP-184 |
| VP-184 the requester cannot approve their own bank change | VP-184 |
| VP-184 the new account number is masked in API responses | VP-184 |
| VP-184 the request and the approval are recorded in the audit trail | VP-184 |
| VP-184 approving a bank change puts payments scheduled to the old account on hold | VP-184 |
| VP-184 Finance redirects a held payment to the new account and it is audited | VP-184 |
| VP-184 the bank change requester cannot decide its held payments | VP-184 |
| VP-185 onboarding, verification and scheduling are recorded with the actor | VP-185 |
| VP-185 audit details never contain a full account number | VP-185 |
| VP-185 Finance Ops cannot read the audit trail | VP-185 |
