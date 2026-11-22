# Contributing to Talaria

Thanks for your interest! Talaria is a young alpha project — issues, bug
reports and PRs are all welcome.

## The clean-room rule

Talaria is **MPL-2.0** and must stay clean of AGPL code. Do **not** copy code
from:

- Bulwark
- plMail
- MailFlow

(all AGPL-3.0). Interface patterns, UX ideas and architecture concepts
learned by observation are fine; verbatim or mechanically-translated code
from those projects is not. When in doubt, write it fresh and link the idea's
source in the PR description.

Code from MIT/BSD/MPL sources (e.g. the commonpost addon, Gofer,
root-fr/jmap-webmail) may be reused with attribution in the file header and
must keep its original license header if it's MPL.

## Development

```sh
cd spa && npm ci && npm run dev      # mock backend, hot reload — no Thunderbird needed
cd sidecar && npm ci && COMMONPOST_MCP_TOKEN=x npm start   # sidecar alone
```

- `spa/src/api/mock-backend.ts` is the demo register — all demo data must be
  **fictional**. Never commit real mail, real contacts, real domains you
  don't own, or credentials of any kind.
- TypeScript is strict: `npm run typecheck` (or `npm run build`, which
  typechecks first) must pass.
- Before opening a PR, run the Playwright checks if you touched anything
  visual: `npm run shots` (and `scripts/phase4-check.mjs` with `MODE=mock`).

## Pull requests

1. Keep the sidecar dependency-light — it's two dependencies (fastify,
   web-push) on purpose.
2. The frontend's contract with the sidecar is documented in
   `sidecar/README.md` — keep both sides in sync in the same PR.
3. One topic per PR; include a screenshot for UI changes.
