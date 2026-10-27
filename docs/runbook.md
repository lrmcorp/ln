# API and development runbook

## API contract, current increment

Routes accept JSON except `/api/intake`, which accepts multipart form data. Staff and customer web authentication uses a signed, HTTP-only, same-site session cookie. Mobile device endpoints use a random bearer token issued through a one-time code. Mutating web requests are checked against the request origin and user role. Errors return `{ "error": "..." }` with a non-2xx status. This is an internal development API and should be versioned before broader native-client use.

| Route | Request | Result |
| --- | --- | --- |
| `POST /api/login` | `{email,password}` | Session cookie |
| `POST /api/logout` | `{}` | Clears cookie |
| `POST /api/actions` | Discriminated action object below | New ID, version, receipt or allocation |
| `POST /api/intake` | Officer multipart identity, KTP photo, liveness video, principal, weeks (must match a policy tenor) | New weekly application ID |
| `POST /api/payments/read` | Owner, branch manager, or assigned officer multipart: `applicationId`, `receipt` image | `{amount,line}` read by OCR, or `{amount:null}`; stores nothing |
| `POST /api/payments` | Owner, branch manager, or assigned officer multipart: `applicationId`, optional integer IDR `amount` (blank = read from receipt), optional `reference`, `amountSource` (`entered`/`read_confirmed`), `receipt` (JPG/PNG/PDF, max 5 MB) | Payment ID, amount, amount source, allocation, remaining balance |
| `GET /api/payments/{paymentId}/receipt` | Owner, same-branch manager, or assigned officer session | Audited encrypted receipt retrieval |
| `POST /api/signing` | Related customer or assigned officer: application ID, name, acceptance, displayed terms hash, signature PNG data URL | Signed agreement hash |
| `GET /api/evidence/{applicationId}/{ktp\|liveness}` | Owner or assigned officer session | Audited encrypted evidence retrieval |
| `GET /api/location` | Session cookie | Own status for customer; scoped latest reports for owner/manager; officer denied |
| `POST /api/location` | Customer `consent` or `report` JSON | Updates permission or latest rounded location |
| `POST /api/mobile/enrollment` | Assigned officer or owner cookie, `{applicationId}` for an active loan | One-time code, expires in 24 hours |
| `POST /api/mobile/activate` | `{code}` | Device bearer token, once per code |
| `GET /api/mobile/status` | Device bearer token | Active-loan and device-consent state |
| `POST /api/mobile/consent` | Device bearer token, `{enabled}` | Starts or stops device sharing |
| `POST /api/mobile/report` | Device bearer token, `{latitude,longitude,accuracy}` | Rounded latest location, only with active loan and consent |

`/api/actions` supports:

- `policy`: `minPrincipal`, `maxPrincipal`, `flatInterestBps`, `minWeeks`, `maxWeeks` (owner).
- `customer`: `name`, 16-digit `nik`, `phone`, `bankName`, numeric `accountNumber` (officer).
- `create`: `customerId`, integer IDR `principal`, integer `weeks` (officer).
- `approve`, `sign`, `authorize`, `close`: `applicationId` (`approve`, `authorize`, `close` owner; `sign` related customer).
- `initiate`: `applicationId`, `idempotencyKey` (owner). Replaying the same key returns `replayed:true`.
- `confirm`: `applicationId`, numeric-string `bankReference`, `proof` (owner, demo adapter only). The string preserves leading zeros.
- `policy` also accepts `weeklyRates`: `[{weeks,rateBps}]`, 1 to 20 unique rows. Repayments moved to `POST /api/payments` because each needs a receipt file.

The server-rendered dashboard currently supplies reads. Before Flutter, add stable versioned read endpoints, pagination, idempotency contracts, and OpenAPI generation.

Browser location reports are accepted only from the customer account while an active loan and separate location consent exist. The customer home (`/`) is visually blank; consent and withdrawal are managed at `/izin-lokasi`. The browser uses device geolocation while either customer page remains open and sends periodic updates after consent. The server stores only the latest coordinates, rounded to three decimal places, with a minimum displayed accuracy of 150 meters. Withdrawal clears the location; payoff also stops sharing. The owner can see all active cases, a manager can see only their branch, and an officer gets HTTP 403. Every monitor read is audited. There is no configured geofence boundary, background collection, or live map. Treat updates as best effort and the 30-second freshness indicator as a signal, not a guarantee.

The Android demo uses a foreground location service instead of an open browser. Its token is stored encrypted with Android Keystore and only its SHA-256 hash is in PostgreSQL. Activation invalidates an older device for the same customer and clears its old location. Android must show a notification; the customer can stop sharing from there. The server rejects reports when no loan is active, when device sharing is off, or after payoff revokes the device. Device onboarding and runtime checks are in `tests/mobile-location.test.ts`; a physical-device test remains necessary before relying on background behavior.

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

`npm run env:init` generates `.env.local` when absent or adds a missing manager demo password to an existing file; it never prints secrets or changes other credentials. `npm run db:seed` is repeatable and does not overwrite existing demo passwords. The migration is repeatable. Use `docker compose down` to stop the local database; avoid `-v` unless intentionally discarding test data.

For a real deployment, replace demo adapters, set `ENABLE_DEMO_ADAPTERS` to false, provision managed PostgreSQL and Redis, use managed secrets and encryption keys, configure TLS, backups and restore drills, implement owner MFA and step-up, and complete the blocked acceptance gates in `phase1.md`. Do not deploy this increment for live lending.
