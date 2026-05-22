X-Minutal Backend Phase 5 — Exceedances Details Backend

What changed:
- Added Cloudflare Worker endpoint: /api/xmin/exceedance-details
- Expanded Exceedances Details records are prepared by the backend when the Details button is opened.
- The main Exceedances summary table, Temperature overview chart, filters, and report behavior remain unchanged.
- If the Worker is not updated, the frontend safely falls back to the existing local details so the UI stays usable.

Required:
- Replace files in the repo.
- Update Cloudflare Worker with backend-cloudflare-worker/src/index.js.

GitHub Desktop summary:
Move X-Minutal exceedance details to backend
