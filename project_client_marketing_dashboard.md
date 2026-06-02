---
name: project-client-marketing-dashboard
description: "Ryan is building a marketing analytics dashboard for a client unifying Airtable, Mailchimp, and GA4 — chose custom Next.js over Looker Studio."
metadata: 
  node_type: memory
  type: project
  originSessionId: 72a4a7ac-bb8a-4a97-a467-42538fd22355
---

Ryan is building a custom client-facing analytics dashboard that pulls from three sources:
- **Airtable** (one base, several views)
- **Mailchimp** (read-only: subscriber count, growth over time, tag/segment counts, opens/clicks over time)
- **GA4** (via the Data API)

**Why:** Client wants charts and data in one place. No cross-source joins required — each source can be its own tab/section.

**How to apply:** Modeled on the co-ventures dashboard pattern (see [[user-dashboard-pattern]]). Adds `@mailchimp/mailchimp_marketing` SDK and `@google-analytics/data` (or use existing `googleapis`). Service account auth for GA4 is the recommended path for single-client deployment.

**Evaluated and rejected:**
- Looker Studio + Coupler.io (~$25–32/mo, daily refresh only on cheap tier, schema/field-mapping pain, deployment-ownership trap)
- Apps Script Community Connectors (20–34h build + 9–13h/yr maintenance, attachment URL expiry conflicts with Looker cache)
- Claude Desktop + MCPs alone (good for ad-hoc but no persistent dashboards)

Ryan may also wire up a Mailchimp MCP in Claude Desktop separately for his own ad-hoc exploration alongside the client dashboard. Recommended server: `damientilman/mailchimp-mcp-server` with `MAILCHIMP_READ_ONLY=true` and `MAILCHIMP_DRY_RUN=true`.
