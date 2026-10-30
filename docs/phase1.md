# Product and technical design

## Operations, accounting and reporting update (2026-10-30)

Implemented after the business review (legal structure, the customer screen, and password/MFA hardening were explicitly deferred by the user):
- **Maker-checker:** payments recorded by officers or read by OCR are `pending` until a manager (same branch) or the owner verifies them; the recorder cannot verify their own entry. Rejection posts a reversing journal and reopens a paid-off loan. Closure is blocked while payments are pending.
- **Cash handling:** cash payments debit `cash_in_transit`; an officer's daily `cash_deposits` row (amount, proof) is compared with recorded cash, and confirmation moves the deposited amount to `cash`. Shortfalls stay visible in transit.
- **Collections:** `applications.collector_id` (defaults to the originator) assigned by manager/owner; `/tagihan` buckets loans into late, due today, promise due, next 7 days; `collection_visits` log outcomes and promise dates (within 14 days); WhatsApp reminder links.
- **Credit rules:** repeat borrowers are matched by NIK hash within the branch; open or written-off loans block a new loan; limit = first-loan cap, raised by the growth rate after an on-time payoff (max DPD 0), kept after a 1-7 day slip, reset after worse. The largest weekly installment must be within the policy share of declared weekly income.
- **Accounting (lib/accounting.ts, lib/ledger.ts):** disbursement credits `unearned_interest`; `runAccruals` (idempotent, per loan, triggered by page loads and every payment) recognises each installment's interest on its due date (capped at the unearned balance), accrues late fees daily on original principal (total capped at principal), records worst DPD, and sets `loan_loss_allowance` by DPD bucket (1/5/25/50/100%). Payments allocate fee, interest, principal. Write-off (owner, DPD ≥ 30) clears receivables against unearned interest, the allowance and `bad_debt_expense`; later receipts are `recovery_income`. Early payoff waives unearned interest. Restructuring (owner) creates an unsigned agreement version; the borrower signs on the officer's device, then the schedule is rebuilt as one settled row plus new weekly rows. Journal uniqueness is per `(event_type, source_id)`.
- **Reports (lib/reports.ts):** PAR 1/7/30 on outstanding principal, collection efficiency (per loan, payments count only up to that week's dues), 12-week cash flow (8 actual, 4 expected), vintage by disbursement week, per-collector performance, CSV export (semicolon, BOM) for Excel.
- **Administration (lib/admin.ts):** branches, staff users (username, role, branch, password reset, deactivate; inactive users cannot sign in or keep sessions), capital movements (`owner_capital`, `investor_capital`, `capital_distributions`; withdrawals cannot exceed cash) and a capital report.
- **Flutter:** `flutter-customer/` reuses the native Keystore store and location service through a MethodChannel; APK built by GitHub Actions.

## Weekly repayment update (2026-10-27)

This supersedes the monthly schedule below. New intake is weekly: the officer picks a tenor from the policy's weekly rate table (default 4 weeks 20%, 5 weeks 25%, 6 weeks 30%; the owner can edit, add, or remove rows, 1 to 52 weeks and 0 to 100%). Interest is `round_half_up(principal × rate)` on top of principal; principal and interest are split evenly across weeks with remainders on the earliest weeks. The borrower signs the amounts and the rule "first installment 7 days after owner approval, then every 7 days"; owner approval creates the dated installments and checks that they match the signed amounts. The assigned field officer, branch manager, or owner records each repayment with a required JPG/PNG/PDF receipt (encrypted, SHA-256 unique) and an optional reference. The amount is optional: `lib/receipt-reader.ts` runs tesseract.js on the server (Indonesian and English models from npm, no network) and picks the labelled, currency-marked figure while skipping fees, balances, references, and dates. The form pre-fills the read amount for confirmation (`read_confirmed`); a blank amount at save is read server-side and stored as `read_auto` for owner review. PDFs are never read. Payments still allocate interest first in the ledger; the UI shows paid versus total due, remaining amount, per-week status, and arrears through today's Jakarta date. Late fees remain described but not accrued. Older monthly applications keep their monthly terms.

## Current monthly intake update (2026-10-25)

The latest user direction supersedes the older weekly example and customer-signing sequence below. The field officer now starts a three-step mobile intake: identity and encrypted KTP/video evidence, monthly amount and schedule, then borrower review and demo signature on the officer's device. A related customer account may open the separate signing page; newly created borrowers do not receive their own login yet. The customer home is blank; the separate `/izin-lokasi` route holds the explicit opt-in/withdrawal controls. Previously consented reporting still runs when the blank page is open. The owner manually reviews evidence and approves only the exact signed terms snapshot before release. A changed agreement requires a new version and signature, but that revision flow is not yet built. Monthly installments begin on the 1st of the month after signing, with principal and total flat interest split across months. Terms show a simple late fee at the policy's monthly rate, initially 5% of original principal, prorated daily with a fixed 30-day divisor after the due date. Fee accrual and payment allocation are not yet implemented, so the demo ledger does not enforce that term. The old weekly route remains for compatibility and tests; it is not the primary UI flow.

## Android location demo update (2026-10-26)

`android-customer/` now contains a native Android APK demo. The assigned officer or owner issues a 24-hour one-time code only after the loan becomes active. The customer enters that code in the APK, separately accepts sharing, and grants foreground plus all-the-time Android location permission. The main activity then renders blank while a foreground location service with a persistent notification reports to authenticated mobile endpoints. The browser can be closed. The server hashes device tokens, verifies active-loan and device consent on every report, and revokes the device once no active loan remains. The APK attempts to resume at boot when Android allows it. Device battery policies, force-stop, offline use, and OS restrictions can interrupt reports; no geographic boundary or reliable continuous tracking is implemented. The APK is a debug build, and physical-device testing plus a reachable HTTPS deployment remain outstanding.

## Architecture and module map

The current code is a modular TypeScript monolith: Next.js renders responsive screens and exposes route handlers; `lib/workflow.ts` owns state transitions and transaction boundaries; `lib/finance.ts` owns integer IDR calculations; `lib/location.ts` owns consent and latest-location access; PostgreSQL holds records, journals, and audit events. Future Flutter clients can use the same API after its contract is versioned. External services belong behind identity, signature, bank, and messaging adapters. The two current demo adapters deliberately refuse to run unless `ENABLE_DEMO_ADAPTERS=true`.

```mermaid
flowchart LR
  W[Owner, manager, officer, customer web] --> API[Next.js API]
  API --> Auth[Identity and role checks]
  API --> Workflow[Loan workflow]
  Workflow --> Finance[Pricing and allocation]
  Workflow --> PG[(PostgreSQL)]
  Workflow -. future .-> Providers[Signature, bank, messaging adapters]
  Flutter[Later Flutter apps] -. same API .-> API
```

Planned module boundaries: identity and branches; customers and verification; products and policy; applications and approval; agreements and activation; disbursement; schedules and repayment; ledger and audit; reporting; consent and notifications. No real provider is selected.

## Data model and ERD

Amounts are integer IDR. Timestamps are stored in UTC; user-facing dates use `Asia/Jakarta`. Policy and agreement snapshots preserve the approved economics.

```mermaid
erDiagram
  BRANCHES ||--o{ USERS : contains
  BRANCHES ||--o{ CUSTOMERS : serves
  CUSTOMERS ||--o{ APPLICATIONS : requests
  CUSTOMERS ||--o| LOCATION_SHARES : consents
  USERS ||--o{ APPLICATIONS : originates
  POLICY_VERSIONS ||--o{ APPLICATIONS : prices
  APPLICATIONS ||--o{ AGREEMENTS : versions
  APPLICATIONS ||--o{ INSTALLMENTS : schedules
  APPLICATIONS ||--o| DISBURSEMENTS : funds
  APPLICATIONS ||--o{ PAYMENTS : receives
  APPLICATIONS ||--o{ JOURNALS : records
  JOURNALS ||--o{ JOURNAL_LINES : balances
  USERS ||--o{ AUDIT_EVENTS : acts
```

The schema is in `db/schema.sql`. Customer NIK is reduced to a keyed duplicate-detection hash and last four digits; full account numbers are not retained in this demo. `location_shares` keeps one rounded latest location per consenting customer, never a movement history. A production implementation needs independent encryption keys, verified identity evidence, secure object storage, location retention enforcement, and access controls.

## Permission matrix

| Operation | Owner | Manager | Assigned officer | Customer |
| --- | --- | --- | --- | --- |
| Create borrower and submit application | No | No | Yes, own branch | No |
| View case | All | No | Own originated cases | No customer case screen |
| View latest consented location | All active cases | Active cases in own branch | No | Own status only |
| Change location consent or report location | No | No | No | Own active case only |
| Create policy version | Yes | No | No | No |
| Approve application | Yes | No | No | No |
| Simulate signature through internal API | No | No | No | Yes; no customer UI |
| Authorize, initiate, confirm transfer | Yes | No | No | No |
| Record repayment with receipt | Yes (verified on entry) | Own branch (verified on entry) | Own or collected loans (pending) | No |
| Verify or reject pending payments and cash deposits | Yes | Own branch | No | No |
| Assign collector, view reports | Yes | Own branch | No | No |
| Write off, restructure, manage branches/users/capital | Yes | No | No | No |
| Log collection visits | No | Own branch | Own collected loans | No |
| View payment receipt | Yes | Own branch | Own assigned loans | No |
| Close paid-off loan | Yes | No | No | No |

The API enforces this matrix. The manager role has branch-scoped location read access and records branch repayments with receipts; it has no approval, disbursement, or closure actions. The owner role is not yet protected by MFA or high-assurance step-up, so it is a development role only.

## State transitions

```mermaid
stateDiagram-v2
  [*] --> submitted
  submitted --> approved: owner approves
  approved --> signed: customer demo signature
  signed --> release_authorized: owner authorizes
  release_authorized --> transfer_initiated: owner initiates
  transfer_initiated --> active: demo settlement evidence
  active --> paid_off: ledger obligations reach zero
  paid_off --> closed: owner closes
```

No receivable exists at approval or signing. The disbursement journal is created only when the demo bank confirmation action marks the loan active. A production system must require independent settlement evidence from a trusted bank or an authorized manual review workflow.

## Calculation specification

- Policy versions hold min/max principal, flat term interest basis points, and term bounds. The seeded 200 basis points is a **demo value**, not a recommended rate.
- Interest in IDR is `round_half_up(principal × basis_points / 10,000)` using `BigInt` before conversion to a safe JavaScript integer.
- Principal and interest are split across weekly installments; remainders are assigned to the earliest installments. The totals always equal the approved snapshot.
- Payment allocation applies to interest receivable first, then principal. Overpayments stop for review. Partial payment and duplicate bank references are supported or rejected respectively.
- Disbursement journals debit principal receivable and interest receivable, credit cash and interest income. Payment journals debit cash and credit the two receivables. Each journal is checked for balance. This prototype recognizes all flat interest at disbursement; production accounting policy needs review.
- Schedule dates derive from the Jakarta calendar date. Existing agreement snapshots do not change when a new policy version is created.

## Screens and journeys

| Screen | Job | Current state |
| --- | --- | --- |
| Sign in | Enter role-specific local workspace | Working demo session |
| Owner overview | Review receivables, pending and active cases | Working, ledger-backed amounts |
| Loan register | Inspect status, approved schedule, collections | Working |
| Borrower intake | Capture synthetic identity, bank details, encrypted KTP photo and video | Working demo; liveness requires manual review |
| Officer application | Monthly amount and schedule, then borrower demo signature | Working demo on officer device |
| Owner policy | Create new policy version | Working subset |
| Owner decision and transfer | Approve, release, initiate, confirm | Working with demo settlement |
| Customer location | Blank home runs consented reporting; `/izin-lokasi` manages permission and withdrawal | Working foreground web demo |
| Superadmin/manager location | View latest coarse location for active, consented cases | Working branch-scoped demo; no map or boundary |
| Payment and closure | Verify partial/full payment, close case | Working |

Staff journey: complete the three-step intake and hand the signing page to the borrower. Owner journey: review identity evidence, approve the same signed terms, authorize and reconcile transfer, verify payments, close; a separate location view shows current consented reports. Manager journey: view only branch-scoped location reports. Customer web journey: sign in to a blank home; the separately addressable `/izin-lokasi` page provides opt-in, withdrawal, and permission status. Reporting continues only while an enabled customer page remains open. The older internal demo signing API remains for legacy workflow tests.

## Acceptance matrix and milestones

| Gate | Evidence now | Release status |
| --- | --- | --- |
| Arithmetic, schedule, payment allocation | Unit tests | Demo verified |
| Role restrictions and scoped reads | Transaction test and API checks | Demo verified; MFA still required |
| Signature version/hash match | Canonical hash check in workflow test | Demo verified; legal provider missing |
| Disbursement idempotency | Replay test | Demo verified |
| Transfer reconciliation | Demo evidence note only | Blocked for real money |
| Location consent and role separation | Integration and browser tests; rounded latest report only | Foreground demo verified; boundary and background tracking absent |
| Balanced journals and zero-balance closure | Integration test | Demo verified |
| Activation codes, PIN, rate limits, device recovery | Not implemented | Blocked |
| KTP verification, OCR, consent and protected files | Not implemented | Blocked |
| Reversals, refunds, write-offs, rescheduling | Not implemented | Blocked |
| Backup restoration, operational security review | Not run | Blocked |

Milestone 1 is this local vertical slice. Milestone 2 should add real identity and customer-direct activation with encrypted storage, rate limits, MFA, and document handling. Milestone 3 should integrate legal signing and bank settlement with independent reconciliation and reversals. Milestone 4 should complete collections, reports, consent, backup restore exercises, and operational review. Flutter phases follow the stable API and shared domain rules.
