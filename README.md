# HUMAN CAPITAL WORKSPACE

Preview: https://bilalteuku17.github.io/human-capital-workspace/

## Status

Foundation build for an AI-operated Human Capital workspace with an isometric 3D office.

- **Frontend:** GitHub Pages. Eight office avatars have defined HC functional roles and matching task-level AI prompts. They are request-driven profiles, not autonomous agents running continuously in the background.
- **Backend:** Cloudflare Worker `human-capital-workspace-ai`.
- **Database:** Cloudflare D1 `human-capital-workspace-db`.
- **AI binding:** Cloudflare Workers AI, model `@cf/zai-org/glm-4.7-flash`.
- **Task persistence:** The UI supports browser-local mode and authenticated D1 API mode. Local tasks can be imported with stable client IDs to avoid duplicate records.
- **Deployment checks:** Worker deployment validates D1, API authentication, AI binding, and health. A production end-to-end smoke test is being added to verify authenticated task creation, real model inference, D1 result persistence, task retrieval, and cleanup. Until that workflow passes against the deployed Worker, production inference must be treated as not yet verified.

## AI employee role model

The eight profiles are HC Strategy & PMO, Organization Development & Workforce, Talent Acquisition, Talent Management & Succession, Learning & Development, Performance Management, HRIS & Process Automation, and People Analytics & Engagement.

A task assigned to one PIC uses that role's prompt. A task assigned to the whole team uses one cross-functional coordinator prompt; it is not automatically split into eight tasks. All execution is request-driven, uses one Workers AI model, and produces a draft for human review. The agents do not operate continuously and have no access to company systems or external tools.

## Backend API

Base URL: `https://human-capital-workspace-ai.bilalteuku17.workers.dev`

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/health` | Public, read-only Worker / D1 / AI-binding status |
| GET | `/api/tasks` | List the latest 100 tasks |
| POST | `/api/tasks` | Create a task |
| GET | `/api/tasks/{id}` | Read one task and its result |
| POST | `/api/tasks/{id}/run` | Execute an eligible task with Workers AI |

Every `/api/*` request requires the `x-hcw-key` header. The health endpoint does not expose secrets.

Task execution creates a draft/work product from the supplied instruction. The model does not have access to company systems, email, files, or external tools, and must not claim to have performed external actions.

## Current activation status

The latest deployment run confirms:

1. The Worker deployment succeeded and the D1 migration step completed.
2. The Worker API key was synchronized from the GitHub Actions secret.
3. Unauthenticated task API requests return HTTP 401 and authenticated requests return HTTP 200.
4. The health check confirms D1 is connected, API authentication is configured, and the Workers AI binding is ready.
5. The current automated Worker tests use a mocked AI binding. They validate application behavior but do not prove live model inference.

The next verification gate is a deployment smoke test that creates a temporary task through the authenticated API, executes it against the live Workers AI model, reads the completed result back from D1, and removes only that temporary smoke-test record. The cleanup route is restricted to task IDs beginning with `hcw-smoke-`; ordinary task IDs cannot be deleted through it.

The shared API key is a temporary single-owner MVP mechanism, not production-grade multi-user authentication. Keep it on a trusted private device only. A proper deployment should replace the shared key with Cloudflare Access or per-user sessions.

## Cost and free-tier boundary

The initial AI model is selected from Cloudflare Workers AI. Cloudflare documents a free allocation of **10,000 Neurons per day**; on the Workers Free plan, requests beyond that allocation fail until the daily reset. Workers Paid usage above the allocation is billed at **$0.011 per 1,000 Neurons**. Monitor usage before enabling frequent or unattended task runs.

- [Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [GLM-4.7-Flash model documentation](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/)

## Deployment

- GitHub Pages deploys from `main` using `.github/workflows/deploy-pages.yml`.
- Cloudflare Worker deploys from changes under `worker/**` using `.github/workflows/deploy-worker.yml`.
- D1 migrations are applied remotely by the Worker deployment workflow.

## Frontend Task API connection

After the GitHub Actions secret `HCW_API_KEY` has been added and the Worker deployment workflow has synchronized it:

1. Open the public preview.
2. In **SYSTEM STATUS · LIVE CHECK**, choose **Hubungkan Task API**.
3. Paste the same key and connect. The UI will load tasks from D1.
4. Create a task and use **Jalankan AI** to request a draft; completed output is shown under **Lihat hasil AI**.

The entered key is held in browser `sessionStorage` for the current tab session and is not embedded in the repository. This is a temporary single-owner MVP bridge, not production-grade multi-user authentication; use it only on a trusted private device. A proper deployment should replace the shared key with Cloudflare Access or per-user sessions.

Tasks created before connecting remain in browser-local storage until the user chooses **Impor tugas lokal ke D1** after connecting. Each task is removed from local storage only after the API acknowledges it. The API uses the local task ID as an idempotency key; a retry with the same content returns the existing record, while conflicting reuse returns HTTP 409. Do not clear browser data until the import is complete.
