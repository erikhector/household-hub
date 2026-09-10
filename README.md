# Squirrel

Tracks home inventory (groceries etc.), flags low/out-of-stock items,
auto-generates shopping lists, plans meals, analyzes grocery cost, and
tracks household income/expenses. See [REQUIREMENTS.md](./REQUIREMENTS.md)
for the full product spec, data model, and conventions.

## Getting started

Requirements: Node 22+, Docker.

```bash
docker compose up -d      # local Postgres
cp .env.example .env      # if .env doesn't already exist
npx prisma migrate dev    # apply the schema
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Sign up to create a
household, or open an invite link (`/join/<token>`) to join an existing one.

Running anywhere other than local dev (staging, production)? Replace the
placeholder `AUTH_SECRET` in `.env` with a real one first — generate it with
`npx auth secret`. See the comment above `AUTH_SECRET` in `.env.example` for
details.

## Scripts

- `npm run dev` — dev server (Turbopack)
- `npm run build` / `npm run start` — production build/serve
- `npm run lint` — ESLint
- `npx tsc --noEmit` — type-check
- `npx prisma studio` — browse the local database
