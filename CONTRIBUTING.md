# Contributing to Talaria

Thanks for your interest! Talaria is a young single-maintainer project, but
PRs and issues are welcome.

## License & clean-room rule

- Everything is [MPL-2.0](LICENSE). By contributing you agree your work is
  released under the same license.
- **No AGPL code.** Code, decompilations, or close translations from AGPL
  webmail projects (Bulwark, plMail, MailFlow, …) cannot be accepted.
  Studying their behavior, patterns and screenshots is fine — copying their
  code is not.

## Ground rules

- **Read `AGENTS.md` first** — it documents the security posture, the known
  addon gotchas, and the verification discipline.
- **Never weaken the security posture.** `sendMail` and the deletion tools
  stay disabled server-side; the composer stays draft-only; the sidecar
  stays behind an authenticating proxy. PRs that change any of this will be
  rejected.
- **No real data, ever.** Screenshots of real mailboxes, real account
  addresses, tokens, or hostnames must not enter the repo (`real-*`
  screenshots and harness output are gitignored — keep them that way).
  Demo data lives in `spa/src/api/mock-backend.ts` and must stay fictional.

## Verification discipline (every change)

```sh
cd spa
npx vue-tsc --noEmit   # typecheck
npm run build          # build (writes into sidecar/public/)
```

Then run the regression harnesses relevant to your change (Playwright,
`spa/scripts/*.mjs`) — mock-mode ones run offline against the authored demo
backend:

```sh
npx vite --port 5173 &          # mock dev server (VITE_BACKEND=mock)
node scripts/settings-check.mjs
node scripts/stage2-mock-check.mjs   # needs a second server on :5174
node scripts/w1-mock-check.mjs
node scripts/stage3-mock-check.mjs
MODE=mock node scripts/phase4-check.mjs
```

The real-mode harnesses need a live sidecar; `stage3-check.mjs` writes test
drafts to a real mailbox — read its header before running it.

## UI changes

`DESIGN.md` is the design contract ("The Registrar"). Keep new UI inside
its rules — semantic daisyUI tokens, agate meta, marginalia confirmations,
honest states. If you add or change a token, update `DESIGN.md` and
`spa/src/style.css` together.

## Commits

Small, focused commits with imperative subjects ("Move the folio into the
rail", not "moved stuff"). If a commit changes behavior, the commit body
should say how it was verified.
