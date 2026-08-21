# 0003. Two processes; the SSR server does not proxy `/api`

**Status:** Implemented

## Context

SSR (0002) makes the front end a running Node server rather than static files. ASP.NET
stopped serving the SPA: `UseDefaultFiles`, `MapStaticAssets`, `MapFallbackToFile` and the
`Microsoft.AspNetCore.SpaProxy` package were all removed.

That leaves two processes, and something has to decide which one serves a given request.

## Decision

Two independent processes:

- **ASP.NET** serves `/api/*` and nothing else.
- **The Node SSR server** renders pages.

**The SSR server does not proxy `/api`.** Routing between the two belongs to the layer in
front of both — CloudFront behaviours in the target architecture (0007), nginx or an ALB
anywhere else. Building a proxy into the SSR server would diverge from that production
shape and quietly make it the API gateway, which it is not.

Locally, `npm run dev` fills the gap: the Vite dev server renders pages *and* proxies
`/api` to ASP.NET.

## Consequences

- **`npm run dev` is the only supported local workflow.** `npm start` serves the production
  build with no proxy, so pages render — loaders reach the API directly through `apiUrl()` —
  while every client-side request 404s. It half-works, which is worse than failing outright,
  and it has already caught someone out.
- There is **no way to run the built app end to end locally** until something plays
  CloudFront's role. A small nginx config, or an Express server with a proxy behind a
  separate script, would fix it if that becomes worth doing.
- The Vite proxy target and the `apiUrl()` base must stay in step, or a loader and a browser
  fetch would hit different origins for the same page and return different results. Both
  default to `http://localhost:5039` and both honour `API_BASE_URL`.
- Server-side loaders target the backend's **plain-HTTP** endpoint on purpose: Node's
  `fetch` rejects the ASP.NET dev certificate. For the same reason `UseHttpsRedirection` is
  skipped in Development.
- Phase 1 deployment work must account for two containers plus a routing layer, not one
  container. This is the main cost of choosing SSR.
