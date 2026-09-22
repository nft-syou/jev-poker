# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private
vulnerability reporting instead: **Security → Report a vulnerability** on this
repository. You will get a reply within a week, and a fix or a decision within
30 days of the report being confirmed.

Please include what you found, how to reproduce it and what you think the
impact is. If you are unsure whether something counts, report it anyway.

## What is in scope

- The proxy (`src/proxy/handler.ts`, `functions/api/jev/[[path]].ts`): anything
  that makes it contact a host other than the fixed upstreams in
  `src/jev/connection.ts`, forward a request it should refuse, or leak a
  caller's credentials or headers.
- Credential handling in the browser (`src/ui/storage.ts`,
  `src/ui/ConnectionModal.tsx`): anything that sends a stored key somewhere
  other than this site's `/api/jev/*` proxy, or exposes it to another origin.
- Dependency vulnerabilities that are reachable from the deployed site.

## What is out of scope

- The security of TypeSafe, Vercel, Lolipop or Cloudflare themselves. Report
  those to the respective provider.
- Rate limiting or abuse of your own upstream account through your own key: the
  proxy forwards whatever a browser holding a valid key sends, by design.
- Issues that require a compromised browser or a malicious browser extension.

## How the app is meant to behave

Players bring their own API key. It lives in the browser's `localStorage` and is
sent only to this site's proxy, which turns it into an `Authorization` header
for one of four fixed upstream hosts and stores and logs nothing. The proxy
never accepts an upstream URL from the request. Details are in the "Security"
section of the [README](README.md#security).

## Supported versions

Only the `main` branch and the deployment built from it receive fixes.
