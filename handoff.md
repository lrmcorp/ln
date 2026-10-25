# Handoff

Read this file before changing the project. After every change, revise the relevant sections and append a dated entry to **Change log** with the change, validation, and any remaining risk. Keep it factual. Do not place passwords, tokens, borrower identity values, or other secrets here.

## Current state

The repository contains a local Phase 1 **demonstration** of LN Operations, an Indonesian loan operating platform. It is not ready for live customers, legal signing, location tracking, or money movement. The internal workflow covers borrower intake, application, owner approval, simulated customer signing through an internal API, release, simulated bank confirmation, repayment, a balanced ledger, and closure. The **customer app is now location only**, per the user's later explicit direction. The source specification is summarized in [docs/phase1.md](docs/phase1.md), but the latest user direction takes precedence over its broader customer-screen list. Use the existing checkout at `/workspace/ln`; the cloud task is already isolated, so create no worktree unless the user requests one.

The interface serves four demo roles: owner/superadmin, branch manager, field officer, and customer. All user-facing UI copy, role labels, status labels, metadata, and API error responses are in Indonesian; internal status codes and API field names remain stable. Owner and officer screens retain the case register and workflow. The customer home screen shows only location consent, permission/report status, last report, viewer roles, and withdrawal. The manager home screen is the branch-scoped location monitor. Owners open the monitor at `/lokasi`. Officers cannot load its API or page. The customer loan dashboard and signing controls were removed from rendered UI. The internal demo `sign` API remains for workflow tests, with no customer signing surface.

## Read next

1. [README.md](README.md) for local setup, demo accounts, and boundaries.
2. [docs/phase1.md](docs/phase1.md) for architecture, data model, permission matrix, financial rules, and release blockers.
3. [docs/runbook.md](docs/runbook.md) for the internal API and startup commands.
4. [AGENTS.md](AGENTS.md) for installed skill instructions and Next.js rules. Read the relevant Next.js guide in `node_modules/next/dist/docs/` before changing framework code.

## Commands and configuration

```bash
cd /workspace/ln
export NPM_CONFIG_CACHE=/tmp/ln-npm-cache
npm ci
npm run env:init
docker compose up -d --wait
npm run db:migrate
npm run db:seed
npm test
npm run build
npm run dev
```

`.env.local` is ignored and contains locally generated demo credentials. `npm run env:init` preserves existing credentials and appends a manager demo password if missing. Never print or commit the file. The cloud environment draft has saved installation and startup instructions. Its startup instruction begins by reading this handoff. A saved draft is not publication; check environment settings and publish status separately.

The customer location update and preview images were pushed to `origin/main` on 2026-10-25. Earlier pushes failed while `GH_TOKEN` was invalid, but the later push succeeded. Check `git status` and `git log -1` for the current checkout state. Do not print or copy the token into commands or files.

The demo signature and bank actions require `ENABLE_DEMO_ADAPTERS=true`. The UI labels them as simulations. Production use needs verified providers and the missing controls listed in `docs/phase1.md`.

## UI and design decisions

Design read: a utilitarian operations screen for staff, plus a single-purpose location control for customers. Dials: **ENERGY 1 / RHYTHM 1 / MOTION 1**. On the customer screen, current permission/status is the focal point; the consent action is one tap away. The monitor shows freshness, last timestamp, and coarse coordinates in one card per active customer. Green marks actionable text; dark ink holds the status panel; neutral surfaces separate records. Georgia headings distinguish the focal state from system-font timestamps and controls. No map, geofence boundary, image, logo, metric, or testimonial was invented. `LN` remains a text wordmark.

Primary UI files: `app/ui/Console.tsx` and `app/style.css`. All six forms use POST as their native method so a submit before JavaScript hydration cannot put a password, NIK, or account number in a query string. Sign-in reloads with `#top`; mutations return to the register or relevant form. The API still performs role checks and validation. The phone case order prioritizes actionable cases; closed cases follow.

The Indonesian UI keeps the existing visual system. Demo identity names are translated only at display time; persisted names, API types, and audit records are unchanged. `app/api/actions/route.ts` maps expected workflow errors to Indonesian and returns a generic Indonesian response for unexpected errors. `README.md` provides Indonesian setup and preview links. The engineering design and runbook remain in English. Current synthetic screenshots in `public/pratinjau/` show customer location permission and owner/manager monitoring. They are static captures served at `/pratinjau/...`, not a live mobile browser view.

Location files: `lib/location.ts`, `app/api/location/route.ts`, `app/ui/LocationApp.tsx`, `app/ui/LocationMonitor.tsx`, and `app/lokasi/page.tsx`. The customer explicitly starts/stops sharing only when a loan is active. The browser reports device location while the page stays open and permission/network are available, sends changed rounded coordinates immediately, limits repeated same-point reports to one per 10 seconds, and tries again every 15 seconds. The monitor polls every 5 seconds. Only the latest rounded coordinates (three decimal places, displayed accuracy at least 150m) are stored. Withdrawal clears them, and payoff disables sharing. The owner can read all active customers; a manager is scoped to their branch; an officer gets HTTP 403. Monitor reads and reports are audited without putting coordinates in audit payloads. There is no configured geographic boundary, live map, background collection, or guaranteed continuous reporting. The latest user selected permission/status focus pending a future boundary choice.

### UI gate, 2026-10-25

| Gate | Result and evidence |
| --- | --- |
| R-02 | PASS: no em dash in UI copy. |
| R-03 | PASS: browser checks found no horizontal overflow at 320, 390, 768, or 1280px. |
| R-17, R-18, R-38 | PASS: amounts and counts come from the database; no testimonials or fictional claims were added. |
| R-23 | PASS: no new visual asset or claimed brand logo was created. |
| R-24 | PASS: navigation and focus links target existing section IDs. |
| R-25 | PASS: rendered Hallmark contrast sweep reported 0 failures; field edges use the muted ink token. |
| R-26 | PASS: browser click-through exercised the links, disclosures, forms, and action buttons. |
| R-27 | PASS: empty register, pending mutation, and request error states exist; the server renders the initial data. |
| R-28 | PASS: no filler FAQ was added. |
| R-32 | PASS: native controls remain keyboard operable; Tab showed a visible focus outline. |
| R-33 | PASS: behavior and styles are in repository source, with no runtime injection. |
| R-34 | PASS: no theme toggle is shipped. |
| R-35 | PASS: build and real browser interaction completed; see Verification. |
| R-36 | PASS: the UI labels signature and bank steps as demo simulations. |
| R-37 | PASS: the design read and three dials above state the direction. |
| Purpose gates | PASS: no gradients, decorative icons, glow, filler cards, or animation stack; the only accent marks actions. |
| Liveliness | PASS: the current-focus panel anchors each screen, with whitespace around the register and a repeated loan-state motif. |
| Craftsmanship locks | PASS: no dead links or buttons were found in the click-through; phone widths and error states were checked. |

Hallmark rendered sweep: **0 FAIL, 0 WARN, 55 WAIVED**. The waivers are one documented `24b` compact-spacing decision applied to existing and changed app controls. It preserved **5/5 links, 18/18 fields, and 14/14 handlers** from the before inventory. Screenshots and the before/after record are under ignored `.hallmark/` paths; `.hallmark/log.json` records the design decision.

## Verification

- `npm test`: 6 passed, including the database workflow from application to closure, location consent/report/withdrawal, manager branch scope, officer denial, and auto-stop at payoff.
- `npm run build`: passed with Next.js 16.4.3 and TypeScript.
- `npm audit --audit-level=high`: 0 vulnerabilities reported.
- Browser click-through on a 390px viewport: empty login validation, sign-in, navigation, case disclosure, borrower creation and handoff, application submission, owner approval, customer demo signing, transfer initiation and confirmation, payment, closure, policy version creation, and sign-out. No page errors were captured. The owner view also passed horizontal-overflow checks at 320, 390, 768, and 1280px.
- A separate production-server browser check followed 12 navigation and sign-out interactions across all three roles. Every anchor reached its section.
- With JavaScript disabled, the login form submitted as POST and kept the password out of the URL. The synthetic officer password was rotated after the initial GET fallback exposed it during testing. No real account was involved.
- Earlier Indonesian update: `npm test` passed 5/5 and `npm run build` passed. Previous customer loan screenshots have been replaced; do not present them as current.
- Location update: browser checks at 390px showed customer-only location controls and fresh reports in owner/manager monitors; officer `GET /api/location` returned 403 and `/lokasi` redirected to their dashboard. A two-session browser test changed the synthetic device position and saw the manager update within the polling window; withdrawing consent hid the coordinates, and re-enabling restored sharing. Customer and manager pages had no horizontal overflow at 320px or 390px and no page errors. Hallmark source/render sweep returned 0 FAIL, 0 WARN, 75 compact-spacing waivers. A synthetic active loan and browser geolocation were used; this does not prove background or production location reliability.
- The environment init script was exercised twice against an older temporary `.env` file: the manager password key was added once and the existing owner key remained unchanged. No password values were printed.

## Caveman and installed skills

The project Antislop skill is `.codex/skills/antislop/SKILL.md`. Hallmark and Caveman skills are installed globally in `/home/agent/.agents/skills/`. The current Antislop **during** mode was a one-session choice; future sessions must follow its mode resolution instructions again.

The Caveman CLI is installed for this machine. `caveman status` reports Codex output, input, and waste-fix modules wired; model routing and scripts are off. The CLI's local `tools shrink` check still reported `engine unavailable; passthrough`, so no token reduction has been measured in this chat. The CLI wiring applies to future local Codex sessions after native hook trust; this managed chat cannot be claimed as proxied. Do not enable model routing solely for token savings.

## Release blockers

Owner MFA and high-assurance actions, customer-direct activation with separate credentials, document evidence, identity verification, encrypted sensitive field storage, legal signing, independent bank settlement, reconciliation exceptions, Redis rate limits, reversals, geofence boundary rules and alerts, reliable background location collection, spoofing resistance, protected production location retention and access controls, background jobs, backup restoration, and Flutter clients remain unimplemented. Browser location can be spoofed and is not proof of presence. The current customer web screen does not support signing or loan review; the internal demo signing API exists for tests only. Keep all production claims and real customer data out until the necessary controls are built and verified.

## Change log

- **2026-10-25:** Moved the register ahead of long forms, added current-focus and per-case next-action labels, and kept existing controls. Added borrower-to-application selection and anchored reloads. Changed all forms to native POST and rotated the synthetic officer password after a pre-hydration GET exposed it in a URL. Validated the database suite, build, rendered Hallmark sweep, and phone browser workflow. Wired Caveman CLI token-saving modules for future local Codex sessions; local shrink still passed through.
- **2026-10-25:** Added the read-first handoff rule to `AGENTS.md`. Rebuilt the production app, reran the rendered design sweep with 0 failures and 0 warnings, and verified 12 role-specific navigation and sign-out interactions.
- **2026-10-25:** Updated the saved cloud startup instruction to read this handoff before repository changes. This draft still needs review and publication in environment settings.
- **2026-10-25:** Translated the user-facing interface, role/status/action labels, metadata, and API errors into Indonesian. Rewrote the README in Indonesian and added desktop/phone captures, including customer phone and approved-loan detail. Verified 5 tests, production build, rendered Hallmark sweep, and 320px/390px browser layouts. One synthetic approved application was added to the local demo database to show the customer action; the screenshots capture that state.
- **2026-10-25:** Attempted to publish the Indonesian update to GitHub. The push failed because the environment's `GH_TOKEN` was invalid. The files and preview images remain committed locally; GitHub publication is pending credential repair.
- **2026-10-25:** Moved the synthetic preview captures into `public/pratinjau/` so the running local server can show them at stable URLs without a sign-in. Checked the image URLs after restarting the server. GitHub publication remains pending credential repair.
- **2026-10-25:** Corrected the customer app scope to location only, added a branch-scoped manager monitor and superadmin monitor, and denied field officers at the API and page. Added explicit active-loan consent, coarse latest-report storage, withdrawal, payoff auto-stop, freshness labels, and location access audit. Removed the customer loan dashboard/signing controls from rendered UI and replaced customer previews with location screens. Verified six tests, typecheck/build, browser permissions and role access, 320px/390px layouts, and Hallmark source/render sweep. Geofence boundary detection and background tracking remain unimplemented.
- **2026-10-25:** Found and fixed a browser reporting delay: same-point reports are throttled, but changed rounded coordinates are sent immediately. Repeated the live browser test; manager updates, withdrawal hiding, and re-enabling passed.
- **2026-10-25:** Pushed the Indonesian UI, revised customer location app, manager/superadmin monitor, tests, docs, and current previews to GitHub `main`. The previously invalid GitHub credential was accepted on this later push.
