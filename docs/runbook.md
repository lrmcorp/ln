# API and development runbook

## API contract, current increment

All routes accept JSON. Authentication uses a signed, HTTP-only, same-site session cookie. Mutating action requests are checked against the request origin and user role. Errors return `{ "error": "..." }` with a non-2xx status. This is an internal development API and should be versioned before native clients use it.

| Route | Request | Result |
| --- | --- | --- |
| `POST /api/login` | `{email,password}` | Session cookie |
| `POST /api/logout` | `{}` | Clears cookie |
| `POST /api/actions` | Discriminated action object below | New ID, version, receipt or allocation |

`/api/actions` supports:

- `policy`: `minPrincipal`, `maxPrincipal`, `flatInterestBps`, `minWeeks`, `maxWeeks` (owner).
- `customer`: `name`, 16-digit `nik`, `phone`, `bankName`, numeric `accountNumber` (officer).
- `create`: `customerId`, integer IDR `principal`, integer `weeks` (officer).
- `approve`, `sign`, `authorize`, `close`: `applicationId` (`approve`, `authorize`, `close` owner; `sign` related customer).
- `initiate`: `applicationId`, `idempotencyKey` (owner). Replaying the same key returns `replayed:true`.
- `confirm`: `applicationId`, numeric-string `bankReference`, `proof` (owner, demo adapter only). The string preserves leading zeros.
- `payment`: `applicationId`, unique `bankReference`, integer IDR `amount` (owner).

The server-rendered dashboard currently supplies reads. Before Flutter, add stable versioned read endpoints, pagination, idempotency contracts, and OpenAPI generation.

## Startup and validation

From the repository root:

```bash
npm ci
npm run env:init
docker compose up -d --wait
npm run db:migrate
npm run db:seed
npm test
npm run build
npm run start
```

`npm run env:init` generates `.env.local` only when absent and never prints its secrets. `npm run db:seed` is repeatable and does not overwrite existing demo passwords. The migration is repeatable. Use `docker compose down` to stop the local database; avoid `-v` unless intentionally discarding test data.

For a real deployment, replace demo adapters, set `ENABLE_DEMO_ADAPTERS` to false, provision managed PostgreSQL and Redis, use managed secrets and encryption keys, configure TLS, backups and restore drills, implement owner MFA and step-up, and complete the blocked acceptance gates in `phase1.md`. Do not deploy this increment for live lending.
