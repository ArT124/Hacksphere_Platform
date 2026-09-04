# HackSphere

HackSphere is a developer platform for discovering hackathons, forming teams, submitting projects, and finding personalized build opportunities.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/hacksphere run dev` — run the web app through its managed workflow
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI
- `pnpm --filter @workspace/db run push` — push DB schema changes (development only)
- Required env: `DATABASE_URL` and `SESSION_SECRET`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React, Vite, Tailwind CSS, Wouter, TanStack Query, Lucide React
- API: Express 5
- Database: PostgreSQL + Drizzle ORM
- Validation: Zod 4
- API codegen: Orval
- Authentication: signed JWT bearer tokens with bcrypt password hashing

## Where things live

- `artifacts/hacksphere/src/` — web app pages, shell, and reusable UI
- `artifacts/api-server/src/routes/` — REST route handlers
- `artifacts/api-server/src/lib/seed.ts` — development seed data
- `artifacts/api-server/src/middleware/auth.ts` — JWT authentication and role checks
- `lib/api-spec/openapi.yaml` — source-of-truth API contract
- `lib/db/src/schema/index.ts` — Drizzle relational schema
- `lib/api-client-react/src/generated/` — generated React Query client

## Architecture decisions

- OpenAPI is the shared contract; frontend hooks and server validators are generated from it.
- Hackathon discovery is filtered in the API before pagination, not by a frontend-only array.
- Recommendations are explainable content-based scores using profile skills, interests, technology overlap, and event mode.
- JWTs are returned by auth endpoints and attached as bearer tokens so the browser session persists without exposing password data.
- Seed data is created only when the development database is empty, keeping restarts idempotent.

## Product

HackSphere includes public discovery and detail pages, account creation and login, user dashboards, personalized recommendations, registrations, bookmarks, teams and invitations, project drafts and submissions, profile editing, organizer analytics, and admin analytics.

## Demo credentials

- User: `user@hacksphere.dev` / `User@123`
- Organizer: `organizer@hacksphere.dev` / `Organizer@123`
- Admin: `admin@hacksphere.dev` / `Admin@123`

## Gotchas

- Run codegen after every OpenAPI change.
- The managed workflows provide `PORT` and `BASE_PATH`; do not hardcode either in application code.
- Development database schema changes are applied with the Drizzle push command.