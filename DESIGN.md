# DESIGN.md — the Talaria design contract

The design language is **"The Registrar"**: the mailbox as a bound register
you consult — never amend. Every screen answers "what does the record say?",
not "what can I do?". Read/triage actions are quiet; write actions confirm
in marginalia; nothing ever destroys.

Tokens and rules live in `spa/src/style.css`; this file is the contract they
implement. When touching UI, work *with* these rules, and update both
together.

## Posture

- **Register, not inbox.** The list is a register page (rows, rulings,
  agate columns). Messages are *entries*; the reader is a *record sheet*.
- **Write actions are marginalia.** Organize results confirm as small
  toasts (marginalia slips) — never dialogs unless irreversible-ish
  (discard draft, close unsaved composer).
- **Honesty over polish.** Loading, empty, error and truncation states say
  what is true ("Draft saved" = the addon accepted it, not IMAP-durable;
  the composer says so). A state that can't be verified is labeled as not
  verified.
- **No send, no delete.** The UI has no affordances for them; the addon
  blocks them server-side. This is a product invariant, not a limitation.

## Surfaces

| Class | Role |
| --- | --- |
| `.record-sheet` | The lifted paper of reader/composer (base-100 + sheet shadow) |
| `.register-row` | One register page row; rhythm via `--row-pad-y` (density) |
| `.agate` | Small tabular meta line (11.5px, tabular-nums, 66% ink) |
| `.masthead-rule` | The 2px accent rule under the wordmark |
| `.unread-dot` | The accent-colored mark — always paired with heavier ink, never color alone |
| `.account-chip` | Per-account hue chip (6 stable hues mapped to semantic tokens) |
| `.register-prose` | Reading typography (Golos Text, 15.5px/1.65, max 68ch) |
| `.marginalia` | Toast slips (180ms rise) |
| `.flip-step` / `.arrive-step` | Motion: ≤120 ms two-frame steps, no long eases |

## Color

daisyUI 5 semantic tokens on Tailwind v4. Components speak only semantic
classes (`base-100/200/300`, `base-content`, `primary`, `accent`, …) so the
37-theme system restyles everything with no component change.

- **Talaria Day / Talaria Night** are the identity themes: deep blue
  `#0a6ce0` primary (white-on-primary ≥ 4.5:1), bright blue `#0a84ff`
  accent (masthead rule + unread marks), cool blue-paper grounds.
- **Blue is the working color.** Rulings between data rows are
  `border-base-300`. Red survives only as `error` (and the light theme's
  paper drift), reserved — never decorative.
- The app ground is never flat: two faint corner tints ("quiet drift"),
  colored by the active theme.

## Type & space

- **Archivo Variable** for UI, **Golos Text Variable** for reading.
- Base 14px UI, 15.5px reading; agate for meta.
- Radii are sharp (`0.25rem` everywhere) — a printed register, not an app
  card farm. Shadows exist to lift sheets, not to decorate.

## Motion

Two-frame steps, ≤120 ms, `steps(2, end)` — page turns, not physics.
Reduced-motion collapses to opacity (see `prefers-reduced-motion` block).

## Accessibility floor

- Unread is never color-only (dot + semibold ink).
- Focus-visible: 2px primary outline, 2px offset.
- Every icon-only control carries an `aria-label`; the register list is a
  `listbox` (`role=option` rows), the view switcher a `tablist`.
- Print isolates the record sheet: chrome drops away (`print:hidden`,
  dedicated print rules).
