# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the TypeScript service. [`src/index.ts`](src/index.ts) wires Express, middleware, routes, and shutdown handling. Shared utilities live in `src/lib/`, auth and request validation live in `src/middleware/`, provider adapters live in `src/providers/`, and shared contracts live in `src/types.ts`. Tests are under `src/__tests__/`. Generated output goes to `dist/`; do not edit compiled files directly. CI lives in `.github/workflows/ci.yml`, and supporting notes belong in `docs/`.

## Build, Test, and Development Commands
Use npm for all local workflows:

- `npm run dev` runs the gateway with `ts-node` against `src/index.ts`.
- `npm run build` compiles the project into `dist/`.
- `npm start` runs the compiled server.
- `npm test` runs the Vitest suite once.
- `npm run test:watch` reruns tests during development.
- `npm run lint` checks `src/` with ESLint.
- `npm run lint:fix` applies safe lint fixes.

CI also runs `npx tsc --noEmit`, `npm audit --omit=dev --audit-level=high`, and a production build.

## Coding Style & Naming Conventions
The codebase uses strict TypeScript, ES2022, and CommonJS output. Match the existing style: 2-space indentation, double quotes, trailing commas, and small focused modules. Use `camelCase` for functions and variables, `PascalCase` for types, and provider filenames that match the vendor, such as `openai.ts` or `perplexity.ts`. ESLint permits intentionally unused parameters only when they are prefixed with `_`.

## Testing Guidelines
Vitest is configured for Node and discovers `src/**/*.test.ts`. Follow the current pattern in [`src/__tests__/smoke.test.ts`](src/__tests__/smoke.test.ts): cover HTTP behavior with `supertest`, mock providers before importing the app, and set required env vars inside the test process. Add tests for auth, validation, provider routing, and response-shape changes.

## Commit & Pull Request Guidelines
Recent history follows Conventional Commits: `feat:`, `fix:`, `chore:`, and `docs:`. Keep subjects imperative and scoped, for example `fix: exclude health checks from rate limiting`. PRs should include a short summary, linked issue when applicable, any env or API changes, and sample request/response payloads for endpoint changes. Ensure lint, tests, type-checking, and CI pass before requesting review.

## Security & Configuration Tips
Never commit real API keys or `GATEWAY_MASTER_KEY` values. Keep secrets in local env files or deployment config. When editing auth, CORS, rate limiting, or readiness behavior in [`src/index.ts`](src/index.ts), preserve the probe split: `/health` and `/ping` stay cheap public liveness endpoints, while `/ready` remains the public readiness check used for deployment and container health.
