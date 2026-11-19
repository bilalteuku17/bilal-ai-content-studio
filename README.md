# HUMAN CAPITAL WORKSPACE

Preview: https://bilalteuku17.github.io/human-capital-workspace/

## Status

Foundation build for an AI-operated Human Capital workspace with an isometric 3D office.

- **Frontend:** GitHub Pages. Eight office avatars now have defined HC functional roles and matching task-level AI prompts. They are still not autonomous agents and do not run continuously in the background.
- **Backend:** Cloudflare Worker `human-capital-workspace-ai`.
- **Database:** Cloudflare D1 `human-capital-workspace-db`.
- **AI binding:** Cloudflare Workers AI, model `@cf/zai-org/glm-4.7-flash`.
- **Task persistence:** the UI now contains both browser-local mode and an authenticated D1 API mode. D1 mode requires `HCW_API_KEY` to be configured and entered in the browser session; end-to-end operation has not yet been verified.

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

## Current activation blocker

The Cloudflare Worker and D1 schema are deployed, and the Workers AI binding is present. However:

1. `HCW_API_KEY` is not yet configured in the GitHub repository or Worker. Protected API requests therefore return HTTP 401.
2. The authenticated API smoke test is skipped until that secret exists.
3. The model inference path has not yet been smoke-tested.
4. The frontend Task Register has code to list/create D1 tasks, request AI execution, and display saved results. The Worker selects one of eight role-specific prompts based on the assigned PIC; an unassigned task uses a cross-functional coordinator prompt. This path remains blocked until `HCW_API_KEY` is configured and entered in the preview. Existing browser-local tasks are not automatically migrated.

To activate API authentication, generate a strong random secret and add it as a **GitHub repository Actions secret** named `HCW_API_KEY`. Do not commit it or paste it into chat. The Worker deployment workflow copies that secret into the Cloudflare Worker when the workflow next runs. After that, the authenticated API can be tested and the UI can be connected.

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

Tasks created before connecting remain in browser-local storage and are not automatically copied to D1. Do not clear browser data until those tasks have been reviewed or manually recreated in D1.
