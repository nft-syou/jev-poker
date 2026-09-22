## What and why

<!-- What changes, and the reason. Link the issue if there is one. -->

## How it was verified

<!-- `pnpm check` is run by CI. Say what else you did: which tests you added, and for
     anything visual, which widths you looked at in a browser. -->

## Checklist

- [ ] `pnpm check` passes locally
- [ ] New behaviour has a test next to the code
- [ ] User-facing strings were added to both `en.json` and `ja.json`
- [ ] The proxy still contacts only the fixed upstream hosts and stores and logs nothing (if `src/proxy`, `functions/` or `src/jev/connection.ts` changed)
- [ ] `CHANGELOG.md` has an entry under Unreleased (for user-visible changes)
