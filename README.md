# LN Operations

This repository contains the first working Phase 1 increment for an Indonesian loan operations platform. It is a **development demonstration**, not a system for real customer data, legal electronic signatures, or bank transfers.

## Run locally

Requires Node 24+, npm, and Docker Compose.

```bash
npm ci
npm run env:init
# The generated demo passwords remain only in .env.local.
docker compose up -d --wait
npm run db:migrate
npm run db:seed
npm test
npm run build
npm run dev
```

Open the app on the local port shown by Next.js. Demo identities are `owner@local.test`, `officer@local.test`, and `customer@local.test`; use the corresponding passwords in your local `.env.local`. The seeded borrower belongs to the customer identity. Use only synthetic borrower and bank details.

The checked-in `.env.example` contains placeholders. Never commit `.env.local`. The demo adapter flag enables simulated signature and bank confirmation. Without it, those actions refuse to proceed until real, verified providers are integrated.

## Current workflow

The field officer creates a borrower and submits an application. The owner approves under the current versioned policy. The demo customer reviews the approved schedule and simulates signing. The owner authorizes release, initiates a transfer, records simulated independent settlement evidence, verifies payments, and closes the paid-off loan. Each state-changing action runs in a database transaction and writes an audit event. Disbursement and payment create balanced ledger journals.

The owner sees ledger-backed principal and interest receivables, approval counts, and the case register. Staff and customer read access is scoped to their assignment or customer identity. The interface is responsive and works without an external provider account.

## Documentation

- [Handoff for future agents](handoff.md)
- [Architecture, data model, rules, and journeys](docs/phase1.md)
- [API and deployment runbook](docs/runbook.md)

## Honest boundary

This increment covers one synthetic happy path and several critical failure paths. It does not implement identity document upload, identity verification, customer-direct activation codes, owner MFA, a legal signing provider, bank integration, encrypted sensitive field storage, Redis rate limiting, location consent, refunds or reversals, background jobs, backups, or Flutter clients. The controls in the prompt that depend on those capabilities remain release blockers. See the staged plan and acceptance matrix in `docs/phase1.md`.
