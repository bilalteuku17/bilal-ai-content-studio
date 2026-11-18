# HUMAN CAPITAL WORKSPACE

Preview: https://bilalteuku17.github.io/human-capital-workspace/

## Status

Foundation build for an AI-operated Human Capital workspace with an isometric 3D office.

- **Frontend:** GitHub Pages. The eight office characters are currently visual placeholders; their roles and autonomous behaviour are not implemented yet.
- **Backend:** Cloudflare Worker `human-capital-workspace-ai`.
- **Database:** Cloudflare D1 `human-capital-workspace-db`.
- **AI binding:** Cloudflare Workers AI, model `@cf/zai-org/glm-4.7-flash`.
- **Task persistence in the current UI:** browser-local storage only. The UI has not yet been connected to the D1 API.

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
4. The browser Task Register still writes to local storage; D1 synchronization and the execution controls are the next frontend integration step.

To activate API authentication, generate a strong random secret and add it as a **GitHub repository Actions secret** named `HCW_API_KEY`. Do not commit it or paste it into chat. The Worker deployment workflow copies that secret into the Cloudflare Worker when the workflow next runs. After that, the authenticated API can be tested and the UI can be connected.

## Cost and free-tier boundary

The initial AI model is selected from Cloudflare Workers AI. Cloudflare documents a free allocation of **10,000 Neurons per day**; on the Workers Free plan, requests beyond that allocation fail until the daily reset. Workers Paid usage above the allocation is billed at **$0.011 per 1,000 Neurons**. Monitor usage before enabling frequent or unattended task runs.

- [Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [GLM-4.7-Flash model documentation](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/)

## Deployment

- GitHub Pages deploys from `main` using `.github/workflows/deploy-pages.yml`.
- Cloudflare Worker deploys from changes under `worker/**` using `.github/workflows/deploy-worker.yml`.
- D1 migrations are applied remotely by the Worker deployment workflow.
