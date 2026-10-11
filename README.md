# EcoRecover AI

**Track:** Waste & Energy (E-waste). Identify an old electronic item from a photo, get safe reuse/repair/disposal guidance, request a collection, and let partners prioritise pickups with a transparent score.

## Run locally (no AWS account needed)
Requires **Node.js 22.13+** (uses the built-in `node:sqlite`).
```bash
npm install
npm test          # 10 tests: auth, roles, upload validation, lifecycle, analytics, priority, rules
npm start         # http://localhost:3000
```
Demo logins: `user@demo.test / User@1234`, `partner@demo.test / Partner@123`, `admin@demo.test / Admin@123`.
On Windows PowerShell set env vars like `$env:JWT_SECRET="..."` before `npm start`.

## AI modes
| `CLASSIFIER` | What happens |
|---|---|
| `demo` (default) | Clearly labelled **demo** result (not a real prediction). User must confirm/change the category. |
| `rekognition` | Real model: Amazon Rekognition `DetectLabels`, labels mapped to categories. Below 70% confidence, or no matching label: shown as uncertain. If the call fails: manual selection. |

## What is implemented
Auth (bcrypt + JWT, roles user/partner/admin), upload validation (type by file signature, 5 MB), classification, recommendation rules (batteries always specialist, no dismantling advice), collection requests with ID, status history and allowed transitions, partner queue with priority reasons, admin partner list, analytics (computed from DB, user-scoped, filters), rate limiting, optional S3 storage.

## Not implemented / differences from the master prompt (be honest in your submission)
- SQLite instead of PostgreSQL/Prisma; plain JS front end instead of React/Vite; no separate FastAPI service (Rekognition is the real model).
- No Playwright tests, no Swagger UI (endpoint list below), no slot management, no proximity scoring (only free-text localities).
- The UI was not browser-tested in the build environment: click through it once before recording.
- SQLite on App Runner is ephemeral: data resets on redeploy (seed data returns).

## API (all JSON: `{data}` or `{error}`)
`POST /api/auth/register|login`, `GET /api/auth/me` | `GET /api/waste/categories`, `GET /api/waste/recommendation?category&condition`, `POST /api/waste/classify` (multipart `image`) | `POST /api/requests`, `GET /api/requests`, `GET /api/requests/:id`, `PATCH /api/requests/:id/status` (partner/admin), `PATCH /api/requests/:id/cancel` | `GET /api/analytics/overview|categories|trends|localities` (`from,to,category,locality`) | `GET /api/admin/requests` (partner/admin), `GET /api/admin/partners` (admin).

## Priority score (configurable via `PRIORITY_WEIGHTS`)
`min(days waiting x 2, 60) + min(quantity x 1.5, 10) + 20 if hazardous`. Hazardous requests go to a separate specialist queue. Not a validated model.

## Analytics assumptions
Estimated kg = quantity x assumed average kg (phone 0.2, laptop 2.5, charger 0.15, cable 0.1, circuit board 0.3, battery 0.05, other 1). Estimates only, not verified recycling. Seed rows are marked sample.

## Deploy on AWS (App Runner + Rekognition + S3)
1. Push this repo to GitHub.
2. S3: create a private bucket (e.g. `ecorecover-uploads-<yourname>`), same region as the app (e.g. `ap-south-1`).
3. IAM: create a role for App Runner **instance** (trust `tasks.apprunner.amazonaws.com`) with only `rekognition:DetectLabels` and `s3:PutObject` on `arn:aws:s3:::<bucket>/uploads/*`.
4. App Runner > Create service > Source: GitHub repo > "Use a configuration file" (`apprunner.yaml`, runtime `nodejs22`). If `nodejs22` is not offered in your console, choose **Docker** (use the included `Dockerfile` via ECR) instead, because the app needs Node 22.13+.
5. Environment variables: `JWT_SECRET` (long random), `NODE_ENV=production`, `CLASSIFIER=rekognition`, `AWS_REGION`, `S3_BUCKET`. Attach the instance role. Health check path: `/api/waste/categories`.
6. Open the service URL, upload a real photo and confirm it shows `rekognition` mode. Only then say it is deployed.
Costs: check current App Runner and Rekognition pricing and free-tier terms in the console; set an AWS Budget alert first. Delete the service after judging.
