/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Mock backend: an in-memory demo register with the exact MailBackend
 * interface. Three accounts, ~70 messages with realistic senders/subjects
 * (mixed DE/EN like the real mailbox), real search-operator behaviour, and
 * two scheduled "arrivals" so the SSE folio flip can be demonstrated in dev.
 * VITE_BACKEND=mock selects it; the UI labels the session "Demo data".
 */

import type { AttachmentPayload, ComposeTarget, CreateFolderResult, DraftFields, DraftResult, MailBackend, MessagePatch, MessageRef, MessageSource, Recipient, UpdateResult } from "./backend-interface";
import { ACCOUNT_PALETTE_SIZE } from "./real-backend";
import type {
  Account,
  AttachmentInfo,
  ContactSearchResult,
  Folder,
  FolderKind,
  HealthInfo,
  MailEvent,
  MailEventCallback,
  MessageAuthentication,
  MessageDetail,
  MessageQuery,
  MessageSummary,
  SearchResult,
} from "./types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Small pause so the mock's optimistic-UI paths are observable. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

interface Seed {
  id: string;
  /** Folder name within the account (resolved against the account's folders). */
  folder: string;
  subject: string;
  author: string;
  recipients: string;
  ccList?: string;
  ago: number;
  read?: boolean;
  flagged?: boolean;
  tags?: string[];
  preview: string;
  attachments?: AttachmentInfo[];
  auth?: MessageAuthentication;
  body?: string;
  /** Messages sharing a thread key form one conversation (`threadOf`). */
  thread?: string;
}

interface AccountSeed {
  id: string;
  label: string;
  email: string;
  type: string;
  folders: Array<{ name: string; kind: FolderKind; depth: number }>;
  messages: Seed[];
}

const ALL_PASS: MessageAuthentication = {
  authservId: "mx01.wernerstudio.de",
  spf: { result: "pass", domain: "mail.wernerstudio.de" },
  dkim: [{ result: "pass", domain: "wernerstudio.de", selector: "sel2026" }],
  dmarc: { result: "pass", domain: "wernerstudio.de" },
};

const GOOGLE_PASS: MessageAuthentication = {
  authservId: "mx.google.com",
  spf: { result: "pass", domain: "amazonses.com" },
  dkim: [
    { result: "pass", domain: "github.com", selector: "githubmail" },
    { result: "pass", domain: "amazonses.com", selector: "hsbnp7" },
  ],
  dmarc: { result: "pass", domain: "github.com" },
};

const SPAM_AUTH: MessageAuthentication = {
  authservId: "unknown",
  spf: { result: "fail", domain: "mailer.delivery-parcel-notify.top" },
  dmarc: { result: "fail", domain: "delivery-parcel-notify.top" },
};

const ACCOUNT_SEEDS: AccountSeed[] = [
  {
    id: "account1",
    label: "Ada Werner",
    email: "ada@wernerstudio.de",
    type: "imap",
    folders: [
      { name: "Inbox", kind: "inbox", depth: 0 },
      { name: "Clients", kind: "folder", depth: 0 },
      { name: "Bauhaus-Medien", kind: "folder", depth: 1 },
      { name: "Newsletter", kind: "folder", depth: 0 },
      { name: "Drafts", kind: "drafts", depth: 0 },
      { name: "Sent", kind: "sent", depth: 0 },
      { name: "Archive", kind: "archive", depth: 0 },
      { name: "Junk", kind: "junk", depth: 0 },
      { name: "Trash", kind: "trash", depth: 0 },
    ],
    messages: [
      {
        id: "m-100",
        folder: "Archive",
        subject: "Logo refresh — first round of variants",
        author: "Mareike Sander <mareike@sander-bauhaus.de>",
        recipients: "ada@wernerstudio.de",
        ago: 12 * DAY,
        read: true,
        preview: "Liebe Ada, hier die erste Runde: drei Varianten für das Redesign des Logos…",
        thread: "t-logo",
        body: `Liebe Ada,

anbei die **erste Runde**: drei Varianten für das Redesign des Vereinslogos.

- **Variante A**: Schraffur, sehr fein — DruckReserved für den Katalog
- **Variante B**: flächige Farbe, kräftig — für Stempel und Social Media
- **Variante C**: Mischform — Fläche + Linie

Schau sie dir in Ruhe an, wir reden nächste Woche darüber.

Liebe Grüße
Mareike`,
      },
      {
        id: "m-101",
        folder: "Inbox",
        subject: "Re: Logo refresh — second round of variants",
        author: "Mareike Sander <mareike@sander-bauhaus.de>",
        recipients: "ada@wernerstudio.de",
        ccList: "Jonas Feld <jonas@sander-bauhaus.de>",
        ago: 42 * MINUTE,
        tags: ["Important"],
        thread: "t-logo",
        preview:
          "Danke für die erste Runde! Die Vorstandschaft hat sich gestern zwei Stunden damit…",
        attachments: [
          { name: "logo-varianten-r2.pdf", size: 2_417_000, contentType: "application/pdf", part: "1.2" },
        ],
        auth: ALL_PASS,
        body: `Danke für die erste Runde, Ada!

Die Vorstandschaft hat gestern zwei Stunden darüber gesprochen (wirklich, zwei Stunden) und ist zu einem überraschend klaren Ergebnis gekommen:

- **Variante C** ist der Favorit — die Reduktion kommt gut an
- Bei Variante A sollen die Schraffuren **deutlich feiner** laufen, sonst wirkt der Katalog „gestrickt“.
- Variante B ist raus, aber die Farbfläche gefiel ihnen — sie fragen, ob das mit C kombinierbar ist

Zwei praktische Fragen:

1. Kriegen wir die Endfassung auch als **SVG mit umgewandelten Pfaden**? Die Druckerei der Mitgliederzeitschrift braucht das.
2. Der Haushalt für diese Runde ist mit 1.800 € veranschlagt — passt Stunde für Stunde, oder müssen wir nachschießen?

Nächster Termin: **Dienstag, 10:00**, Atelier oder per Meet — sagt mir, was besser ist.

Liebe Grüße
Mareike

--
Mareike Sander · Geschäftsführung
Sander-Bauhaus Medien GmbH`,
      },
      {
        id: "m-102",
        folder: "Inbox",
        subject: "[wernerstudio/atelier-api] CI failed on main (run #1 284)",
        author: "GitHub Actions <notifications@github.com>",
        recipients: "ada@wernerstudio.de",
        ago: 2 * HOUR + 12 * MINUTE,
        preview: "Run #1284 failed: 2 tests in exports/pdf-export.test.ts timed out after 60 s…",
        auth: GOOGLE_PASS,
        body: `**Run #1284 failed** on \`main\` — 2 failures.

| Check | Result |
| --- | --- |
| lint | pass |
| typecheck | pass |
| unit (214) | **2 failed** |

\`\`\`
FAIL  exports/pdf-export.test.ts
  ● renders umlauts correctly in embedded fonts (11.2 s)
  ● flushes pending pages before stream end (60.0 s timeout)
\`\`\`

Zeynep hat in der ähnlichen Richtung umgebaut ([#412](https://github.com/wernerstudio/atelier-api/pull/412)) — vermutlich ein Rebase-Detail.

You are receiving this because you are a maintainer of wernerstudio/atelier-api.`,
      },
      {
        id: "m-103",
        folder: "Inbox",
        subject: "Ihre Rechnung 24816/11 — Hetzner Online GmbH",
        author: "Hetzner Online GmbH <rechnung@hetzner.de>",
        recipients: "ada@wernerstudio.de",
        ago: 5 * HOUR,
        read: true,
        preview: "Rechnungsbetrag: 41,76 € · fällig am 30.11.2026 · SEPA-Lastschrift in 4 Tagen…",
        attachments: [{ name: "rechnung-24816.pdf", size: 82_400, contentType: "application/pdf", part: "1" }],
        auth: {
          authservId: "mx.hetzner.de",
          spf: { result: "pass", domain: "hetzner.de" },
          dkim: [{ result: "pass", domain: "hetzner.de", selector: "hx2025" }],
          dmarc: { result: "pass", domain: "hetzner.de" },
        },
        body: `Guten Tag Ada Werner,

unsere Rechnung **Nr. 24816/11** für Ihren Server CX42 (atelier-host) ist verfügbar.

| Position | Betrag |
| --- | --- |
| Cloud Server CX42 | 26,91 € |
| Backups (7 Tage) | 4,90 € |
| Traffic-Flat | 9,95 € |
| **Gesamt (brutto)** | **41,76 €** |

Fällig am **30.11.2026** per SEPA-Lastschrift. Details im PDF.

Mit freundlichen Grüßen
Ihr Hetzner Team`,
      },
      {
        id: "m-104",
        folder: "Inbox",
        subject: "Fahrkarte Berlin Hbf → Leipzig Hbf, Sa 29.11.",
        author: "Deutsche Bahn <noreply@bahn.de>",
        recipients: "ada@wernerstudio.de",
        ago: 8 * HOUR,
        read: true,
        flagged: true,
        tags: ["Travel"],
        preview: "BahnCard-Rabatt berücksichtigt · Abfahrt 09:34 ab Gleis 4 · Barkasse im DB Navigator…",
        attachments: [{ name: "ticket-9f3k2.pdf", size: 180_200, contentType: "application/pdf", part: "1" }],
        auth: {
          authservId: "mx.bahn.de",
          spf: { result: "pass", domain: "bahn.de" },
          dkim: [{ result: "pass", domain: "bahn.de", selector: "db" }],
          dmarc: { result: "pass", domain: "bahn.de" },
        },
      },
      {
        id: "m-105",
        folder: "Inbox",
        subject: "Frage zu Großformatdruck für die Vernissage",
        author: "Zeynep Aydın <zeynep@druckwerk-nk.de>",
        recipients: "ada@wernerstudio.de",
        ago: 26 * HOUR,
        tags: ["Work"],
        preview: "Wir könnten 3 Banner (200×120) auf dem neuen UV-Gerät machen — Papier würde ich…",
        auth: ALL_PASS,
        body: `Hallo Ada,

kurz vor dem Wochenende noch die Druckfrage für die Vernissage am 5.12.:

Wir könnten **drei Banner (200 × 120 cm)** auf dem neuen UV-Gerät laufen lassen. Papier hätte ich da — **Gmund Bio Matt, 240 g** — aber wenn du lieber auf Stoff willst, muss ich Freitag entscheiden bestellen.

Kosten: ca. **68 €/Banner** auf Papier, Stoff käme auf ~110 €.

Gib mir bis Freitag Mittag Bescheid, dann plane ich die Maschine ein.

Beste Grüße
Zeynep

Druckwerk Neukölln · Werkstraßen-Druckerei`,
      },
      {
        id: "m-106",
        folder: "Inbox",
        subject: "Kurz: Montag-Status Atelier API",
        author: "Jannis Roth <jannis@wernerstudio.de>",
        recipients: "ada@wernerstudio.de",
        ago: 3 * DAY + 1 * HOUR,
        read: true,
        preview: "PDF-Export steht, Umlaute müssen noch ins Subset. Katalog-Import: 80 %…",
        auth: ALL_PASS,
        body: `Moin Ada,

kurzer Stand vor dem Montag:

- **PDF-Export**: steht, Umlaute müssen noch ins Font-Subset (siehe CI-Fail von heute)
- **Katalog-Import**: 80 %, fehlt noch die Bildseiten-Zuordnung
- Ich bin Do+Fr in Leipzig bei der Messe — erreichbar per Signal

Jannis`,
      },
      {
        id: "m-107",
        folder: "Newsletter",
        subject: "Your weekly briefing from Thunderbird",
        author: "Thunderbird <news@thunderbird.net>",
        recipients: "ada@wernerstudio.de",
        ago: 4 * DAY,
        read: true,
        preview: "This week: Monthly release 140.3.0 ships a new address book cache; plus community…",
      },
      {
        id: "m-108",
        folder: "Inbox",
        subject: "Paket kommt heute zwischen 14:00 und 18:00 — Sendung 0034…K2",
        author: "DHL Paket <noreply@dhl.de>",
        recipients: "ada@wernerstudio.de",
        ago: 5 * DAY + 3 * HOUR,
        read: true,
        preview: "Ihr Paket mit 3 Positionen (Papiermuster Gmund) ist in der Zustellung…",
      },
      {
        id: "m-109",
        folder: "Inbox",
        subject: "Domain wernerstudio.de: Zertifikat in 14 Tagen fällig",
        author: "cron <root@atelier-host.wernerstudio.de>",
        recipients: "root@wernerstudio.de",
        ago: 6 * DAY,
        read: true,
        preview: "certbot renewal due: wernerstudio.de, www.wernerstudio.de expire 2026-12-05…",
      },
      {
        id: "m-110",
        folder: "Inbox",
        subject: "Re: Server-Quote backups — bitte auf 14 Tage erhöhen",
        author: "Jannis Roth <jannis@wernerstudio.de>",
        recipients: "ada@wernerstudio.de",
        ago: 7 * DAY,
        read: true,
        preview: "Erledigt — liegt jetzt bei 14 Tagen, 62 GB. Der Spike kam vom Katalog-Import…",
      },
      {
        id: "m-111",
        folder: "Archive",
        subject: "Ihre Kommunalen Angaben 2026 — bitte prüfen",
        author: "Amt für Statistik <noreply@berlin.de>",
        recipients: "ada@wernerstudio.de",
        ago: 9 * DAY,
        read: true,
        preview: "Bitte prüfen Sie die übermittelten Angaben bis 30.11.2026…",
      },
      {
        id: "m-112",
        folder: "Inbox",
        subject: "Atelier-Termine KW 48",
        author: "Mareike Sander <mareike@sander-bauhaus.de>",
        recipients: "ada@wernerstudio.de",
        ccList: "jannis@wernerstudio.de",
        ago: 11 * DAY,
        read: true,
        tags: ["Work"],
        preview: "Dienstag 10:00 Vorstand, Donnerstag Druckabnahme, Freitag Vernissage-Bau…",
      },
      {
        id: "m-113",
        folder: "Archive",
        subject: "Verlängerung Hosting atelier-host bis 2027 bestätigt",
        author: "Hetzner Online GmbH <rechnung@hetzner.de>",
        recipients: "ada@wernerstudio.de",
        ago: 13 * DAY,
        read: true,
        preview: "Ihre Verlängerung ist bestätigt: CX42, 12 Monate ab 01.12.2026…",
      },
      {
        id: "m-114",
        folder: "Sent",
        subject: "Rechnung 2026-11 — Atelier-API Wartung",
        author: "Ada Werner <ada@wernerstudio.de>",
        recipients: "jonas@sander-bauhaus.de",
        ago: 12 * DAY,
        read: true,
        preview: "Guten Tag Jonas, anbei die Wartungsrechnung November: 18 Std à 85 €…",
      },
      {
        id: "m-115",
        folder: "Inbox",
        subject: "AW: Rechnung 2026-10",
        author: "Jonas Feld <jonas@sander-bauhaus.de>",
        recipients: "ada@wernerstudio.de",
        ago: 16 * DAY,
        read: true,
        preview: "Rechnung ist zur Zahlung freigegeben, läuft mit der nächsten Sammelzahlung…",
      },
      {
        id: "m-116",
        folder: "Sent",
        subject: "Kickoff Katalog Frühjahr — Notizen",
        author: "Ada Werner <ada@wernerstudio.de>",
        recipients: "mareike@sander-bauhaus.de",
        ago: 21 * DAY,
        read: true,
        preview: "Zusammenfassung vom Kickoff: 84 Seiten, Umschlag 4/1, Innenteil 1/1…",
      },
      {
        id: "m-117",
        folder: "Drafts",
        subject: "Entwurf: Antwort an Mareike (Varianten R2)",
        author: "Ada Werner <ada@wernerstudio.de>",
        recipients: "mareike@sander-bauhaus.de",
        ago: 30 * MINUTE,
        preview: "Liebe Mareike, danke für die klare Rückmeldung — Variante C kommt am Dienstag…",
      },
      {
        id: "m-118",
        folder: "Sent",
        subject: "Re: Logo refresh — first round of variants",
        author: "Ada Werner <ada@wernerstudio.de>",
        recipients: "mareike@sander-bauhaus.de",
        ago: 11 * DAY,
        read: true,
        thread: "t-logo",
        preview: "Variante A hat den besten Charakter — ich baue die Schraffuren aber feiner…",
        body: `Liebe Mareike,

danke für die Runde. Kurz mein Eindruck:

- **Variante A** hat den besten Charakter — die Schraffuren baue ich feiner aus
- Variante B wirkt auf den ersten Blick, erschöpft aber schnell
- Bei C stört mich die Fläche — sie konkurriert mit der Linie

Ich bringe eine überarbeitete Fassung von A zur Vorstandssitzung mit.

Ada`,
      },
      {
        id: "m-120",
        folder: "Clients",
        subject: "Freigabe Unterseiten Katalog (Ende der Woche)",
        author: "Jonas Feld <jonas@sander-bauhaus.de>",
        recipients: "ada@wernerstudio.de",
        ago: 2 * DAY,
        read: true,
        preview: "Seiten 12–40 sind freigegeben, Bildseiten folgen Mittwoch. Impressum…",
      },
      {
        id: "m-121",
        folder: "Clients",
        subject: "Bildrechte: drei Fotos von Ruster benötigen",
        author: "Foto Ruster <studio@ruster-foto.de>",
        recipients: "ada@wernerstudio.de",
        ago: 8 * DAY,
        read: true,
        preview: "Für die Bildseiten brauchen wir drei Motive aus der Atelier-Serie…",
      },
      {
        id: "m-122",
        folder: "Clients",
        subject: "Druckdaten: Beschnitt 3 mm, Profile im Anhang",
        author: "Druckwerk Neukölln <produktion@druckwerk-nk.de>",
        recipients: "ada@wernerstudio.de",
        ago: 15 * DAY,
        read: true,
        preview: "Anbei die ICC-Profile und die Beschnittvorgaben für den Katalog…",
      },
      {
        id: "m-123",
        folder: "Bauhaus-Medien",
        subject: "Unterlagen Vorstandssitzung (intern)",
        author: "Mareike Sander <mareike@sander-bauhaus.de>",
        recipients: "ada@wernerstudio.de",
        ago: 18 * DAY,
        read: true,
        preview: "Die Protokolle und die Budgettabelle für die Sitzung im Anhang…",
      },
      {
        id: "m-130",
        folder: "Newsletter",
        subject: "The Counterfeit Coffee Club — Issue #42",
        author: "Counterfeit Coffee <hello@counterfeit.coffee>",
        recipients: "ada@wernerstudio.de",
        ago: 20 * HOUR,
        read: true,
        preview: "This week: the filter revival nobody asked for, and why your kettle matters…",
      },
      {
        id: "m-131",
        folder: "Newsletter",
        subject: "c't magazin: Wochenrückblick KW 47",
        author: "c't <newsletter@ct.de>",
        recipients: "ada@wernerstudio.de",
        ago: 3 * DAY,
        read: true,
        preview: "AMD-Update, IPv6-Deadline verschoben, und: Tastatur der Woche…",
      },
      {
        id: "m-132",
        folder: "Newsletter",
        subject: "Monotype Monthly: Neue Grotesk releases",
        author: "Monotype <news@monotype.com>",
        recipients: "ada@wernerstudio.de",
        ago: 10 * DAY,
        read: true,
        preview: "This month: three grotesk cuts, one variable serif, and a specimen film…",
      },
      {
        id: "m-140",
        folder: "Junk",
        subject: "YOUR PARCEL IS HELD - PAY RELEASE FEE €1.95",
        author: "Parcel Release <no-reply@delivery-parcel-notify.top>",
        recipients: "ada@wernerstudio.de",
        ago: 7 * HOUR,
        preview: "Your parcel 0034-K2 awaits customs release. Pay €1.95 within 24h to…",
        auth: SPAM_AUTH,
      },
      {
        id: "m-141",
        folder: "Junk",
        subject: "congratulationz!! you are WINNER",
        author: "International Lottery <claims@lott0-intl.biz>",
        recipients: "ada@wernerstudio.de",
        ago: 2 * DAY + 5 * HOUR,
        preview: "Dear winner your email has been selected in our quarterly draw of 2.4…",
        auth: { authservId: "unknown", spf: { result: "none" }, dmarc: { result: "none" } },
      },
    ],
  },
  {
    id: "account2",
    label: "",
    email: "ada.werner@gmail.com",
    type: "imap",
    folders: [
      { name: "Inbox", kind: "inbox", depth: 0 },
      { name: "Archive", kind: "archive", depth: 0 },
      { name: "Sent", kind: "sent", depth: 0 },
      { name: "Trash", kind: "trash", depth: 0 },
    ],
    messages: [
      {
        id: "m-201",
        folder: "Inbox",
        subject: "Dein Kontoauszug für November ist bereit",
        author: "Stadtsparkasse <konto@sparkasse.example>",
        recipients: "ada.werner@gmail.com",
        ago: 1 * DAY + 4 * HOUR,
        tags: ["Important"],
        preview: "Ihr Kontoauszug 11/2026: 142 Umsätze, Saldo +2.845,10 €. Im banking-Portal…",
        auth: {
          authservId: "mx.sparkasse.example",
          spf: { result: "pass", domain: "sparkasse.example" },
          dkim: [{ result: "pass", domain: "sparkasse.example", selector: "sk" }],
          dmarc: { result: "pass", domain: "sparkasse.example" },
        },
        body: `Guten Tag Ada Werner,

Ihr Kontoauszug für **November 2026** ist im Banking-Portal bereit.

- 142 Umsätze
- Saldo: **+2.845,10 €**
- Größter Einzelumsatz: Miete 940,00 €

Zur Sicherheit: Wir fragen **niemals** per E-Mail nach TAN oder Passwort.

Ihre Stadtsparkasse`,
      },
      {
        id: "m-202",
        folder: "Inbox",
        subject: "Security alert: new sign-in from Firefox on Linux",
        author: "Google <no-reply@accounts.google.com>",
        recipients: "ada.werner@gmail.com",
        ago: 6 * HOUR,
        preview: "A new sign-in to ada.werner@gmail.com from Firefox 140 on Linux (Berlin, DE)…",
        auth: GOOGLE_PASS,
        body: `**New sign-in**

Firefox 140 · Linux · Berlin, DE · 21 Nov, 18:12

If this was you: nothing to do.
If not: [check activity](https://accounts.google.com) and change your password.`,
      },
      {
        id: "m-203",
        folder: "Inbox",
        subject: "Buchgruppe Dezember: „Der Zinkelhof“ — Termin & Snacks",
        author: "Lena Buchbach <lena@buchgruppe-nk.de>",
        recipients: "ada.werner@gmail.com",
        ago: 2 * DAY,
        read: true,
        preview: "Wir treffen uns am 11.12., diesmal bei Miriam. Bringst du das Brot mit?…",
      },
      {
        id: "m-205x",
        folder: "Inbox",
        subject: "Weihnachtsmarkt: Schichtplan — Bitte um Rückmeldung",
        author: "Lena Buchbach <lena@buchgruppe-nk.de>",
        recipients: "ada.werner@gmail.com",
        ago: 6 * DAY,
        read: true,
        thread: "t-markt",
        preview: "Liebe alle, der Stand braucht noch zwei Personen für den Samstagvormittag…",
        body: `Liebe alle,

der Stand auf dem Weihnachtsmarkt braucht noch **zwei Personen für den Samstagvormittag** (10–14 Uhr). Sonntag ist komplett offen.

Bitte meldet euch bei mir, ich trage euch in den Plan ein.

Lena`,
      },
      {
        id: "m-204",
        folder: "Inbox",
        subject: "Re: Weihnachtsmarkt Schichtplan",
        author: "Miriam Stall <miriam@buchgruppe-nk.de>",
        recipients: "ada.werner@gmail.com",
        ago: 4 * DAY,
        read: true,
        thread: "t-markt",
        preview: "Samstag 14–16 Uhr wäre frei, Sonntag ist noch alles offen…",
        body: `Hi,

Samstag **14–16 Uhr** wäre bei mir frei — ich übernehme die Kasse.

Sonntag ist noch alles offen, vielleicht finden sich noch zwei Leute.

Miriam`,
      },
      {
        id: "m-205",
        folder: "Inbox",
        subject: "Dein Patreon: druckwerk-nk posted a new post",
        author: "Patreon <noreply@patreon.com>",
        recipients: "ada.werner@gmail.com",
        ago: 5 * DAY,
        read: true,
        preview: "„Siebdruck-Session Nr. 12“ — Fotos von der Maschine und ein…",
      },
      {
        id: "m-206",
        folder: "Archive",
        subject: "Flugbestätigung: XQ 342 Antalya, 14.03.2027",
        author: "SunExpress <ticketing@sunexpress.example>",
        recipients: "ada.werner@gmail.com",
        ago: 9 * DAY,
        read: true,
        flagged: true,
        preview: "Buchung 7XQK2L bestätigt. Hinflug 14.03.2027 10:45, Rückflug 28.03.…",
      },
      {
        id: "m-207",
        folder: "Archive",
        subject: "Ihre Rechnung für den Speicherplatz",
        author: "Fotobuch-Service <rechnung@fotobuch.example>",
        recipients: "ada.werner@gmail.com",
        ago: 30 * DAY,
        read: true,
        preview: "Speicherplatz 200 GB, 12 Monate: 59,40 € — bezahlt am 22.10.…",
      },
      {
        id: "m-208",
        folder: "Inbox",
        subject: "Re: Wanderweekend Harz — Anzahlung",
        author: "Lena Buchbach <lena@buchgruppe-nk.de>",
        recipients: "ada.werner@gmail.com",
        ago: 34 * DAY,
        read: true,
        preview: "Die Hütte ist fix, 240 € Anzahlung ist überwiesen. Liste der…",
      },
      {
        id: "m-209",
        folder: "Inbox",
        subject: "Ihre Impf-Erinnerung: Tetanus auffrischen",
        author: "Praxis Dr. Hoffmann <praxis@hoffmann.example>",
        recipients: "ada.werner@gmail.com",
        ago: 40 * DAY,
        read: true,
        preview: "Ihre letzte Tetanus-Impfung liegt 11 Jahre zurück. Termin online…",
      },
      {
        id: "m-210",
        folder: "Inbox",
        subject: "Bahncard: Rechnung für dein Abo",
        author: "Deutsche Bahn <noreply@bahn.de>",
        recipients: "ada.werner@gmail.com",
        ago: 44 * DAY,
        read: true,
        preview: "Abo-Abrechnung BahnCard 25: 41,25 € monatlich, nächste Abbuchung…",
      },
    ],
  },
  {
    id: "account3",
    label: "Feldverein Neukölln",
    email: "vorstand@feldverein.org",
    type: "imap",
    folders: [
      { name: "Inbox", kind: "inbox", depth: 0 },
      { name: "Protokolle", kind: "folder", depth: 0 },
      { name: "Sent", kind: "sent", depth: 0 },
      { name: "Trash", kind: "trash", depth: 0 },
    ],
    messages: [
      {
        id: "m-301",
        folder: "Inbox",
        subject: "Gartenfest am Samstag — letzte Absprachen",
        author: "Tuana Kaya <tuana@feldverein.org>",
        recipients: "vorstand@feldverein.org",
        ccList: "alle@feldverein.org",
        ago: 3 * HOUR,
        tags: ["Important"],
        preview: "Kuchen-Plan: Ada (Apfel), Rainer (Zwetschgen), Tuana (Rhubarb). Grill übernimmt…",
        auth: {
          authservId: "mx.feldverein.org",
          spf: { result: "pass", domain: "feldverein.org" },
          dkim: [{ result: "pass", domain: "feldverein.org", selector: "fv" }],
          dmarc: { result: "pass", domain: "feldverein.org" },
        },
        body: `Hallo Vorstand,

kurz die letzte Absprache für **Samstag, 14 Uhr**:

- **Kuchen**: Ada (Apfel), Rainer (Zwetschgen), Tuana (Rhabarber)
- **Grill**: übernimmt Rainer mit eigenem Gerät
- **Kasse**: Schwarmkasse auf den Tisch, Tuana zählt um 17 Uhr
- **Wetter**: 11 °C, bewölkt — das Zelt steht schon

Der neue **Wasserhahn** am Geräteschuppen ist eingebaut (Danke, Rainer!). Die Rechnung liegt im Ordner Protokolle.

Bitte alle 15 Minuten früher — die ersten Gäste kommen bestimmt wieder zu früh.

Grüße
Tuana`,
      },
      {
        id: "m-302",
        folder: "Inbox",
        subject: "Wasserhahn Rechnung — 84,50 €",
        author: "Baumarkt Neukölln <rechnung@baumarkt-nk.example>",
        recipients: "vorstand@feldverein.org",
        ago: 1 * DAY,
        read: true,
        attachments: [{ name: "rechnung-88412.pdf", size: 44_800, contentType: "application/pdf", part: "1" }],
        preview: "Rechnung 88412, bezahlt auf das Vereinskonto, Position: Außenarmatur…",
      },
      {
        id: "m-303",
        folder: "Protokolle",
        subject: "Protokoll Vorstandssitzung 12.11.",
        author: "Rainer Stemm <rainer@feldverein.org>",
        recipients: "vorstand@feldverein.org",
        ago: 9 * DAY,
        read: true,
        preview: "Anwesend: alle. TOP 1 Wasserhahn, TOP 2 Gartenfest, TOP 3 Saatgut…",
      },
      {
        id: "m-304",
        folder: "Inbox",
        subject: "Frühjahrs-Saatgut: Bestellliste bis Ende Januar",
        author: "Tuana Kaya <tuana@feldverein.org>",
        recipients: "vorstand@feldverein.org",
        ago: 14 * DAY,
        read: true,
        preview: "Wir bestellen wieder bei der Genossenschaft — diesmal Sorten für…",
      },
      {
        id: "m-305",
        folder: "Inbox",
        subject: "Re: Vereinskonto — neue Karte für Tuana",
        author: "Rainer Stemm <rainer@feldverein.org>",
        recipients: "vorstand@feldverein.org",
        ago: 20 * DAY,
        read: true,
        preview: "Karte ist beantragt, PIN kommt getrennt. Unterschriftsberechtigung…",
      },
      {
        id: "m-306",
        folder: "Inbox",
        subject: "Herbstabschluss: Laubsäcke, Kompost, Rückfragen",
        author: "Nachbarschaftshilfe <buero@nhn-nk.example>",
        recipients: "vorstand@feldverein.org",
        ago: 25 * DAY,
        read: true,
        preview: "Die 12 Laubsäcke sind abgeholt. Kompostplatz bleibt bis Dezember…",
      },
      {
        id: "m-307",
        folder: "Inbox",
        subject: "Mitgliedsbeitrag 2026: 24 Überweisungen offen",
        author: "Rainer Stemm <rainer@feldverein.org>",
        recipients: "vorstand@feldverein.org",
        ago: 30 * DAY,
        read: true,
        preview: "Stand heute: 24 Mitglieder haben noch nicht überwiesen. Liste…",
      },
    ],
  },
];

/* ---------- seed compilation ---------- */

function folderPathOf(account: AccountSeed, folderName: string): string {
  const host = `imap://${encodeURIComponent(account.email)}@mail.example`;
  return `${host}/${folderName}`;
}

interface CompiledMessage {
  summary: MessageSummary;
  detail: Omit<MessageDetail, "id" | "folderPath" | "subject" | "author" | "recipients" | "ccList" | "date" | "tags">;
}

function compile(): {
  accounts: Account[];
  folders: Folder[];
  messages: Map<string, CompiledMessage>;
} {
  const accounts: Account[] = [];
  const folders: Folder[] = [];
  const messages = new Map<string, CompiledMessage>();
  const now = Date.now();

  ACCOUNT_SEEDS.forEach((seed, index) => {
    accounts.push({
      id: seed.id,
      label: seed.label || seed.email,
      email: seed.email,
      type: seed.type,
      colorIndex: index % ACCOUNT_PALETTE_SIZE,
      identities: [
        { id: `${seed.id}-id1`, email: seed.email, name: seed.label || seed.email, isDefault: true },
      ],
    });
    const pathByFolder = new Map<string, string>();
    for (const folderSeed of seed.folders) {
      const path = folderPathOf(seed, folderSeed.name);
      pathByFolder.set(folderSeed.name, path);
      folders.push({
        path,
        name: folderSeed.name,
        kind: folderSeed.kind,
        accountId: seed.id,
        total: 0,
        unread: 0,
        depth: folderSeed.depth,
        favorite: folderSeed.kind === "inbox",
      });
    }
    for (const m of seed.messages) {
      const folderPath = pathByFolder.get(m.folder) ?? pathByFolder.get("Inbox")!;
      const date = new Date(now - m.ago).toISOString();
      messages.set(m.id, {
        summary: {
          id: m.id,
          folderPath,
          subject: m.subject,
          author: m.author,
          recipients: m.recipients,
          ccList: m.ccList ?? "",
          date,
          read: m.read ?? false,
          flagged: m.flagged ?? false,
          tags: m.tags ?? [],
          preview: m.preview,
          hasAttachments: m.attachments && m.attachments.length > 0 ? true : undefined,
        },
        detail: {
          body: m.body ?? generatedBody(m),
          bodyFormat: "markdown",
          attachments: m.attachments ?? [],
          authentication: m.auth,
          bodyTruncated: false,
        },
      });
    }
  });

  for (const folder of folders) {
    let total = 0;
    let unread = 0;
    for (const row of messages.values()) {
      if (row.summary.folderPath !== folder.path) continue;
      total += 1;
      if (!row.summary.read) unread += 1;
    }
    folder.total = total;
    folder.unread = unread;
  }
  return { accounts, folders, messages };
}

function generatedBody(seed: Seed): string {
  return [
    seed.preview,
    "",
    "—",
    "",
    "This entry is part of the **Talaria demo register**: the mock backend keeps every",
    "interaction strictly in memory. Point the app at the real sidecar with",
    "`VITE_BACKEND=real` to read your actual mailbox.",
  ].join("\n");
}

/* ---------- Phase 4 demo data: contacts, agenda ---------- */

const CONTACT_BOOKS = [
  { addressBookId: "jsaddrbook://abook.sqlite", name: "Personal Address Book", readOnly: false, default: true },
  { addressBookId: "jsaddrbook://history.sqlite", name: "Collected Addresses", readOnly: false, default: false },
];

interface ContactSeed {
  id: string;
  book: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  emails: string[];
  phones?: Array<{ type: string; number: string }>;
  addresses?: Array<{ type: string; street?: string; city?: string; postalCode?: string }>;
  organization?: string;
  title?: string;
  note?: string;
  birthday?: string;
}

const CONTACT_SEEDS: ContactSeed[] = [
  {
    id: "c-mareike",
    book: "jsaddrbook://abook.sqlite",
    displayName: "Mareike Sander",
    firstName: "Mareike",
    lastName: "Sander",
    emails: ["mareike@sander-bauhaus.de"],
    phones: [{ type: "mobile", number: "+49 172 5350081" }],
    organization: "Sander-Bauhaus Medien GmbH",
    title: "Geschäftsführung",
    note: "Bevorzugt Montags-Voicecalls. Katalog-Druck läuft immer über Druckwerk Neukölln.",
    birthday: "1984-03-17",
  },
  {
    id: "c-jonas",
    book: "jsaddrbook://abook.sqlite",
    displayName: "Jonas Feld",
    firstName: "Jonas",
    lastName: "Feld",
    emails: ["jonas@sander-bauhaus.de"],
    organization: "Sander-Bauhaus Medien GmbH",
    title: "Projektleitung",
  },
  {
    id: "c-zeynep",
    book: "jsaddrbook://abook.sqlite",
    displayName: "Zeynep Aydın",
    firstName: "Zeynep",
    lastName: "Aydın",
    emails: ["zeynep@druckwerk-nk.de"],
    phones: [{ type: "work", number: "+49 30 63901728" }, { type: "mobile", number: "+49 176 44223009" }],
    organization: "Druckwerk Neukölln",
    addresses: [{ type: "work", street: "Werkstraße 12", city: "Berlin", postalCode: "12043" }],
    note: "UV-Großformat seit 2026. Papierbestellungen bis Freitag 12 Uhr für die Folgewoche.",
  },
  {
    id: "c-jannis",
    book: "jsaddrbook://abook.sqlite",
    displayName: "Jannis Roth",
    firstName: "Jannis",
    lastName: "Roth",
    emails: ["jannis@wernerstudio.de"],
    phones: [{ type: "mobile", number: "+49 157 81234867" }],
  },
  {
    id: "c-tuana",
    book: "jsaddrbook://abook.sqlite",
    displayName: "Tuana Kaya",
    firstName: "Tuana",
    lastName: "Kaya",
    emails: ["tuana@feldverein.org"],
    organization: "Feldverein Neukölln",
    birthday: "1991-11-30",
  },
  {
    id: "c-rainer",
    book: "jsaddrbook://abook.sqlite",
    displayName: "Rainer Stemm",
    firstName: "Rainer",
    lastName: "Stemm",
    emails: ["rainer@feldverein.org"],
    phones: [{ type: "home", number: "+49 30 5512944" }],
  },
  {
    id: "c-lena",
    book: "jsaddrbook://abook.sqlite",
    displayName: "Lena Buchbach",
    firstName: "Lena",
    lastName: "Buchbach",
    emails: ["lena@buchgruppe-nk.de"],
    phones: [{ type: "mobile", number: "+49 176 90877612" }],
  },
  {
    id: "c-hetzner",
    book: "jsaddrbook://history.sqlite",
    displayName: "Hetzner Online GmbH",
    emails: ["rechnung@hetzner.de"],
    organization: "Hetzner Online GmbH",
  },
  {
    id: "c-dhl",
    book: "jsaddrbook://history.sqlite",
    displayName: "DHL Paket",
    emails: ["noreply@dhl.de"],
  },
];

const CALENDAR_SEEDS = [
  { id: "cal-atelier", name: "Atelier", supportsEvents: true, supportsTasks: true, disabled: false },
  { id: "cal-holidays", name: "Feiertage", supportsEvents: true, supportsTasks: false, disabled: false },
  { id: "cal-archive", name: "Archiv (lokal)", supportsEvents: true, supportsTasks: true, disabled: true },
];

/** An event at `day` offset from today, `hour`:{minute} local, lasting minutes. */
function at(day: number, hour?: number, minute = 0, durationMinutes = 60): { start: string; end: string; allDay: boolean } {
  const start = new Date();
  start.setDate(start.getDate() + day);
  if (hour === undefined) {
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start: start.toISOString(), end: end.toISOString(), allDay: true };
  }
  start.setHours(hour, minute, 0, 0);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  return { start: start.toISOString(), end: end.toISOString(), allDay: false };
}

const EVENT_SEEDS: Array<{ id: string; calendarId: string; title: string; location?: string; slot: ReturnType<typeof at>; recurring?: boolean }> = [
  { id: "e-vorstand", calendarId: "cal-atelier", title: "Vorstandssitzung — Logo R2", location: "Atelier / Meet", slot: at(1, 10, 0, 90) },
  { id: "e-druck", calendarId: "cal-atelier", title: "Druckabnahme Banner", location: "Druckwerk Neukölln", slot: at(2, 14, 0, 90) },
  { id: "e-geburtstag", calendarId: "cal-atelier", title: "Tuana hat Geburtstag", slot: at(3), recurring: true },
  { id: "e-essen", calendarId: "cal-atelier", title: "Familienessen", slot: at(4, 12, 30, 120) },
  { id: "e-vernissage", calendarId: "cal-atelier", title: "Vernissage Katalog", location: "Sander-Bauhaus Foyer", slot: at(5, 18, 0, 180) },
  { id: "e-advent", calendarId: "cal-holidays", title: "Erster Advent", slot: at(6) },
];

const TASK_SEEDS = [
  { id: "t-saatgut", calendarId: "cal-atelier", title: "Saatgut-Bestellung stellen", dueInDays: 5, completed: false, priority: 5 },
  { id: "t-bildrechte", calendarId: "cal-atelier", title: "Bildrechte Ruster klären", dueInDays: 2, completed: false, priority: 1 },
  { id: "t-rechnung", calendarId: "cal-atelier", title: "Wasserhahn-Rechnung einreichen", dueInDays: -3, completed: true, priority: 9 },
];

/* ---------- operator-aware mock search ---------- */

function tokenize(query: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(query)) !== null) {
    tokens.push(match[1] !== undefined ? `"${match[1]}"` : match[2]);
  }
  return tokens;
}

interface ParsedQuery {
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  participant?: string;
  words: string[];
}

function parseQuery(query: string): ParsedQuery {
  const parsed: ParsedQuery = { words: [] };
  let leadOperator: keyof Omit<ParsedQuery, "words"> | null = null;
  for (const token of tokenize(query)) {
    const lead = token.match(/^(from|to|cc|subject|participant):$/i);
    if (lead) {
      leadOperator = lead[1]!.toLowerCase() as keyof Omit<ParsedQuery, "words">;
      continue;
    }
    const op = token.match(/^(from|to|cc|subject|participant):(.*)$/i);
    if (op) {
      const key = op[1]!.toLowerCase() as keyof Omit<ParsedQuery, "words">;
      const value = op[2].replace(/^"|"$/g, "");
      parsed[key] = key === "subject" ? `${parsed[key] ?? ""} ${value}`.trim() : value;
      leadOperator = null;
      continue;
    }
    if (leadOperator) {
      const value = token.replace(/^"|"$/g, "");
      parsed[leadOperator] = `${parsed[leadOperator] ?? ""} ${value}`.trim();
      leadOperator = null;
      continue;
    }
    parsed.words.push(token.replace(/^"|"$/g, "").toLowerCase());
  }
  return parsed;
}

function textMatch(hay: string, needle: string): boolean {
  return hay.toLowerCase().includes(needle.toLowerCase());
}

/* ---------- the backend ---------- */

export function createMockBackend(): MailBackend {
  const compiled = compile();
  const threadKeys = new Map<string, string>();
  /** Draft id → the message it quotes (reply/forward drafts keep the quote on autosave). */
  const draftQuotes = new Map<string, string>();
  for (const seed of ACCOUNT_SEEDS) {
    for (const m of seed.messages) {
      if (m.thread) threadKeys.set(m.id, m.thread);
    }
  }
  let lastUnread = countUnread();

  function countUnread(): number {
    let unread = 0;
    for (const folder of compiled.folders) {
      if (folder.kind === "trash" || folder.kind === "junk") continue;
      unread += folder.unread;
    }
    return unread;
  }

  /** Folder tallies after an in-memory write (same loop compile() runs). */
  function recomputeTallies() {
    for (const folder of compiled.folders) {
      let total = 0;
      let unread = 0;
      for (const row of compiled.messages.values()) {
        if (row.summary.folderPath !== folder.path) continue;
        total += 1;
        if (!row.summary.read) unread += 1;
      }
      folder.total = total;
      folder.unread = unread;
    }
  }

  /** Thread membership is transitive: any member id resolves the whole thread. */
  function threadOfMessage(id: string): string | null {
    return threadKeys.get(id) ?? null;
  }

  /* ---- W2 drafts: the demo compose helpers (closure over the register) ---- */

  function recipientsHeader(recipients?: Recipient[]): string {
    return (recipients ?? [])
      .filter((r) => r.email)
      .map((r) => (r.name && r.name !== r.email ? `${r.name} <${r.email}>` : r.email))
      .join(", ");
  }

  /** The demo Drafts folder of an account — made on first use. */
  function draftsFolderFor(accountId: string): Folder {
    const existing = compiled.folders.find((f) => f.accountId === accountId && f.kind === "drafts");
    if (existing) return existing;
    const root = compiled.folders.find((f) => f.accountId === accountId);
    const path = `${root ? root.path.slice(0, root.path.lastIndexOf("/")) : "imap://demo@mail.example"}/Drafts`;
    const folder: Folder = { path, name: "Drafts", kind: "drafts", accountId, total: 0, unread: 0, depth: 0, favorite: false };
    compiled.folders.push(folder);
    return folder;
  }

  /** Store (or rewrite) one demo draft, mirroring the addon's contract.
   *  keepQuote=true with draftId replaces the typed text and keeps the
   *  quote block the demo added when the draft was created (reply/fwd);
   *  undefined fields keep what the demo draft already has. */
  function storeDraft(fields: DraftFields, draftId: string | undefined, keepQuote: boolean, meta: { from: string; subject?: string; quoteOf?: CompiledMessage }): DraftResult {
    let row = draftId ? compiled.messages.get(draftId) : undefined;
    const identityAccount =
      compiled.accounts.find((a) => a.identities.some((i) => i.email === meta.from)) ?? compiled.accounts[0]!;
    const drafts = draftsFolderFor(identityAccount.id);
    const to = recipientsHeader(fields.to);
    const cc = recipientsHeader(fields.cc);
    const subject = fields.subject !== undefined ? fields.subject : (row?.summary.subject ?? "");
    const quoteId = meta.quoteOf?.summary.id ?? (draftId ? draftQuotes.get(draftId) : undefined);
    const quoted = quoteId ? compiled.messages.get(quoteId) : undefined;
    // Quote block: appended when a reply/forward creates the draft, and kept
    // on updates only while keepQuote asks for it (autosave path).
    const keepQuoteBlock = meta.quoteOf !== undefined || (draftId !== undefined && keepQuote);
    const quote =
      quoted && keepQuoteBlock && fields.body !== undefined
        ? `\n\n<blockquote><p>On ${quoted.summary.date}, ${quoted.summary.author} wrote:</p><p>${escapeHtml(quoted.detail.body)}</p></blockquote>`
        : "";
    const bodyHtml =
      fields.body !== undefined
        ? /<[a-z][\s\S]*>/i.test(fields.body)
          ? fields.body // already HTML (forward quotes): store verbatim
          : `<p>${escapeHtml(fields.body).replaceAll("\n", "<br />")}</p>${quote}`
        : (row?.detail.body ?? "");
    if (row) {
      row.summary.subject = subject;
      if (fields.to !== undefined) row.summary.recipients = to;
      if (fields.cc !== undefined) row.summary.ccList = cc;
      if (fields.body !== undefined) {
        row.detail.body = bodyHtml;
        row.detail.bodyFormat = "html";
      }
      if (quoteId) draftQuotes.set(row.summary.id, quoteId);
    } else {
      const id = `m-draft-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`;
      const summary: MessageSummary = {
        id,
        folderPath: drafts.path,
        subject: subject || "(no subject)",
        author: meta.from,
        recipients: to,
        ccList: cc,
        date: new Date().toISOString(),
        read: true,
        flagged: false,
        tags: [],
        preview: (fields.body ?? "").slice(0, 120),
      };
      row = {
        summary,
        detail: { body: bodyHtml, bodyFormat: "html", attachments: [], authentication: undefined, bodyTruncated: false },
      };
      compiled.messages.set(id, row);
      if (quoteId) draftQuotes.set(id, quoteId);
    }
    recomputeTallies();
    lastUnread = countUnread();
    return { success: true, messageId: row.summary.id, folderPath: drafts.path, subject, to };
  }

  return {
    kind: "mock",

    async listAccounts() {
      return compiled.accounts;
    },

    async listFolders(accountId) {
      return compiled.folders.filter((f) => !accountId || f.accountId === accountId);
    },

    async searchMessages(query: MessageQuery): Promise<SearchResult> {
      const parsed = parseQuery(query.text ?? "");
      let rows = [...compiled.messages.values()];

      if (query.scopeFolder) {
        const prefix = query.scopeFolder;
        rows = rows.filter((m) => m.summary.folderPath.startsWith(prefix));
      }
      if (query.unreadOnly) rows = rows.filter((m) => !m.summary.read);
      if (query.flaggedOnly) rows = rows.filter((m) => m.summary.flagged);
      if (!query.scopeFolder) {
        // Mirror the sidecar: whole-register searches skip Trash and Junk.
        const trashish = new Set(
          compiled.folders.filter((f) => f.kind === "trash" || f.kind === "junk").map((f) => f.path),
        );
        rows = rows.filter((m) => !trashish.has(m.summary.folderPath));
      }
      rows = rows.filter((m) => {
        const s = m.summary;
        if (parsed.from && !textMatch(s.author, parsed.from)) return false;
        if (parsed.to && !textMatch(`${s.recipients} ${s.ccList}`, parsed.to)) return false;
        if (parsed.cc && !textMatch(s.ccList, parsed.cc)) return false;
        if (parsed.subject && !textMatch(s.subject, parsed.subject)) return false;
        if (parsed.participant) {
          const domains = parsed.participant
            .split(",")
            .map((d) => d.trim().replace(/^@?/, "").toLowerCase())
            .filter(Boolean);
          const addresses = `${s.author} ${s.recipients} ${s.ccList}`.toLowerCase();
          if (!domains.some((d) => addresses.includes(`@${d}`))) return false;
        }
        for (const word of parsed.words) {
          const hay = `${s.subject} ${s.author} ${s.recipients} ${s.ccList} ${s.preview}`.toLowerCase();
          if (!hay.includes(word)) return false;
        }
        return true;
      });
      rows.sort((a, b) => b.summary.date.localeCompare(a.summary.date));

      const offset = query.offset ?? 0;
      const limit = query.maxResults ?? 50;
      const page = rows.slice(offset, offset + limit);
      return {
        messages: page.map((m) => m.summary),
        totalMatches: rows.length,
        offset,
        limit,
        hasMore: offset + limit < rows.length,
      };
    },

    async getMessage(id, folderPath) {
      const row = compiled.messages.get(id);
      if (!row || row.summary.folderPath !== folderPath) {
        throw new Error("Message not found in the demo register.");
      }
      const s = row.summary;
      const detail: MessageDetail = {
        id: s.id,
        folderPath: s.folderPath,
        subject: s.subject,
        author: s.author,
        recipients: s.recipients,
        ccList: s.ccList,
        date: s.date,
        tags: s.tags,
        ...row.detail,
      };
      return detail;
    },

    async getThread(id) {
      // Demo conversations are keyed; the thread answer is cross-folder and
      // chronological (oldest first), mirroring the sidecar's threadOf.
      const key = threadOfMessage(id);
      const rows = key
        ? [...compiled.messages.values()].filter((m) => threadOfMessage(m.summary.id) === key)
        : [compiled.messages.get(id)].filter((m): m is CompiledMessage => m !== undefined);
      rows.sort((a, b) => a.summary.date.localeCompare(b.summary.date));
      return {
        messages: rows.map((m) => m.summary),
        totalMatches: rows.length,
        offset: 0,
        limit: 50,
        hasMore: false,
      };
    },

    async getMessages(items) {
      const details: MessageDetail[] = [];
      for (const item of items) {
        try {
          details.push(await this.getMessage(item.id, item.folderPath));
        } catch {
          /* per-item failures are tolerated, like the real batch tool */
        }
      }
      return details;
    },

    async getMessageBodyChunk(id, folderPath, offset) {
      const detail = await this.getMessage(id, folderPath);
      if (offset <= 0 || offset >= detail.body.length) {
        return { text: "", nextBodyOffset: undefined, bodyTruncated: false };
      }
      // The demo register never truncates; chunking is emulated for parity.
      return { text: detail.body.slice(offset), nextBodyOffset: undefined, bodyTruncated: false };
    },

    /* ---- Stage 2: read-for-export (fabricated raw source, honest bytes) ---- */

    /** A minimal RFC 822 rendering of a demo record — enough for the .eml
     *  export flow to behave exactly as it does against the real sidecar. */
    async getMessageSource(id, folderPath): Promise<MessageSource> {
      const detail = await this.getMessage(id, folderPath);
      const lines = [
        `Message-ID: <${detail.id}>`,
        `Date: ${detail.date}`,
        `From: ${detail.author}`,
        `To: ${detail.recipients || "(undisclosed-recipients)"}`,
        detail.ccList ? `Cc: ${detail.ccList}` : "",
        `Subject: ${detail.subject}`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: 8bit",
        "",
        detail.body,
      ].filter((line) => line !== "");
      return { bytes: new TextEncoder().encode(lines.join("\r\n")) };
    },

    async getAttachment(id, folderPath, attachment): Promise<AttachmentPayload> {
      const detail = await this.getMessage(id, folderPath);
      const known = detail.attachments.find((a) => a.name === attachment.name);
      if (!known) throw new Error("Attachment not found in the demo register.");
      // Deterministic demo bytes (never a real document): a header line, the
      // attachment name and padding — enough to prove the download path.
      const text = [
        `Talaria demo attachment — ${known.name}`,
        `content-type: ${known.contentType ?? "application/octet-stream"}`,
        "",
      ].join(" ").padEnd(Math.min(known.size ?? 512, 640), "·");
      return { bytes: new TextEncoder().encode(text) };
    },

    /* ---- W1 organize (Round 3): demo writes, strictly in memory ---- */

    async updateMessages(items: MessageRef[], patch: MessagePatch): Promise<UpdateResult> {
      await delay(180); // let the optimistic UI be visible
      let updated = 0;
      const notFound: string[] = [];
      for (const item of items) {
        const row = compiled.messages.get(item.id);
        if (!row || row.summary.folderPath !== item.folderPath) {
          notFound.push(item.id);
          continue;
        }
        if (patch.read !== undefined) row.summary.read = patch.read;
        if (patch.flagged !== undefined) row.summary.flagged = patch.flagged;
        if (patch.moveTo !== undefined) row.summary.folderPath = patch.moveTo;
        updated += 1;
      }
      recomputeTallies();
      lastUnread = countUnread();
      return { updated, notFound };
    },

    async createFolder(parentPath, name): Promise<CreateFolderResult> {
      await delay(180);
      const taken = compiled.folders.some((f) => f.path === `${parentPath}/${name}`);
      if (taken) throw new Error("A folder with that name already exists in the demo register.");
      const parent = compiled.folders.find((f) => f.path === parentPath);
      compiled.folders.push({
        path: `${parentPath}/${name}`,
        name,
        kind: "folder",
        accountId: parent?.accountId ?? compiled.accounts[0]?.id ?? "account1",
        total: 0,
        unread: 0,
        depth: (parent?.depth ?? -1) + 1,
        favorite: false,
      });
      return { name, path: `${parentPath}/${name}` };
    },

    /* ---- W2 drafts composer (Round 3, Stage 3): demo drafts, in memory ----
     * Same shapes the real backend answers: a Drafts folder per identity
     * (created on demand, like Thunderbird's drafts-folder pref), messageId +
     * folderPath back, updates rewrite in place, replies/forwards prefill
     * recipients the way Thunderbird computes them (simplified). */

    async saveDraft(fields: DraftFields, draftId?: string, keepQuote = true): Promise<DraftResult> {
      await delay(160);
      const from = fields.from || compiled.accounts[0]!.identities[0]!.email;
      return storeDraft(fields, draftId, keepQuote, { from, subject: fields.subject || "(no subject)" });
    },

    async replyDraft(target: ComposeTarget, fields: DraftFields, replyAll: boolean): Promise<DraftResult> {
      await delay(160);
      const original = compiled.messages.get(target.id);
      if (!original) throw new Error("Message not found in the demo register.");
      const from = fields.from || original.summary.recipients || compiled.accounts[0]!.identities[0]!.email;
      const subject = /^re:/i.test(original.summary.subject) ? original.summary.subject : `Re: ${original.summary.subject}`;
      // The prefill (reply: the author; reply-all: author + everyone else) is
      // authoritative here — the demo stores exactly the fields passed.
      void replyAll;
      return storeDraft(fields, undefined, true, { from, subject, quoteOf: original });
    },

    async forwardDraft(target: ComposeTarget, fields: DraftFields): Promise<DraftResult> {
      await delay(160);
      const original = compiled.messages.get(target.id);
      if (!original) throw new Error("Message not found in the demo register.");
      const from = fields.from || compiled.accounts[0]!.identities[0]!.email;
      const subject = `Fwd: ${original.summary.subject}`;
      return storeDraft(fields, undefined, true, { from, subject, quoteOf: original });
    },

    async hasComposeTools(): Promise<boolean> {
      return true;
    },

    async listAddressBooks() {
      return CONTACT_BOOKS.map((b) => ({ id: b.addressBookId, name: b.name, readOnly: b.readOnly, isDefault: b.default }));
    },

    async searchContacts(query, offset = 0): Promise<ContactSearchResult> {
      const q = (query ?? "").trim().toLowerCase();
      const matched = CONTACT_SEEDS.filter((c) => {
        if (!q) return true;
        const hay = `${c.displayName} ${c.emails.join(" ")} ${c.organization ?? ""} ${c.lastName ?? ""}`.toLowerCase();
        return q.split(/\s+/).every((word) => hay.includes(word));
      });
      const page = matched.slice(offset, offset + 50);
      return {
        contacts: page.map((c) => ({
          id: c.id,
          addressBookId: c.book,
          displayName: c.displayName,
          email: c.emails[0] ?? "",
          organization: c.organization ?? "",
        })),
        hasMore: offset + 50 < matched.length,
        nextOffset: offset + 50 < matched.length ? offset + 50 : undefined,
      };
    },

    async getContact(id) {
      const c = CONTACT_SEEDS.find((contact) => contact.id === id);
      if (!c) throw new Error("Unknown contact in the demo register.");
      const book = CONTACT_BOOKS.find((b) => b.addressBookId === c.book);
      return {
        id: c.id,
        addressBookId: c.book,
        displayName: c.displayName,
        email: c.emails[0] ?? "",
        organization: c.organization ?? "",
        firstName: c.firstName ?? "",
        lastName: c.lastName ?? "",
        emails: c.emails.map((value, i) => ({ type: i === 0 ? "primary" : "email", value })),
        phones: (c.phones ?? []).map((p) => ({ type: p.type, value: p.number })),
        addresses: (c.addresses ?? []).map((a) => ({
          type: a.type,
          value: [a.street, a.postalCode, a.city].filter(Boolean).join(", "),
        })),
        title: c.title ?? "",
        note: c.note ?? "",
        birthday: c.birthday ?? "",
        addressBookName: book?.name ?? "Address book",
      };
    },

    async listCalendars() {
      return CALENDAR_SEEDS.map((c, i) => ({
        id: c.id,
        name: c.name,
        readOnly: false,
        disabled: c.disabled,
        supportsEvents: c.supportsEvents,
        supportsTasks: c.supportsTasks,
        colorIndex: i % ACCOUNT_PALETTE_SIZE,
      }));
    },

    async listEvents(range) {
      const start = new Date(range.start).getTime();
      const end = new Date(range.end).getTime();
      return EVENT_SEEDS.filter((e) => {
        const t = new Date(e.slot.start).getTime();
        return t >= start && t <= end;
      }).map((e) => ({
        id: e.id,
        calendarId: e.calendarId,
        calendarName: CALENDAR_SEEDS.find((c) => c.id === e.calendarId)?.name ?? "Calendar",
        title: e.title,
        startDate: e.slot.start,
        endDate: e.slot.end,
        allDay: e.slot.allDay,
        location: e.location ?? "",
        isRecurring: e.recurring ?? false,
      }));
    },

    async listTasks() {
      return TASK_SEEDS.filter((t) => !t.completed).map((t) => ({
        id: t.id,
        calendarId: t.calendarId,
        title: t.title,
        dueDate: at(t.dueInDays).start,
        completed: t.completed,
        priority: t.priority,
      }));
    },

    async getHealth(): Promise<HealthInfo> {
      return {
        ok: true,
        commonpost: {
          reachable: true,
          port: 8780,
          serverInfo: { name: "mock-commonpost", version: "0.0.0-demo" },
        },
        uptime: Math.round(performance.now() / 1000),
      };
    },

    onMailEvent(callback: MailEventCallback) {
      // Two scheduled demo arrivals make the folio flip observable in dev.
      const timers: ReturnType<typeof setTimeout>[] = [];
      const arrival = (seed: { subject: string; author: string; accountId: string }) => {
        const account = compiled.accounts.find((a) => a.id === seed.accountId);
        const inbox = compiled.folders.find((f) => f.accountId === seed.accountId && f.kind === "inbox");
        if (!account || !inbox) return;
        const id = `demo-${Date.now()}`;
        const row: CompiledMessage = {
          summary: {
            id,
            folderPath: inbox.path,
            subject: seed.subject,
            author: seed.author,
            recipients: account.email,
            ccList: "",
            date: new Date().toISOString(),
            read: false,
            flagged: false,
            tags: [],
            preview: "Arrived during this demo session — injected by the mock backend.",
            hasAttachments: undefined,
          },
          detail: {
            body: `**Demo arrival.** This message was injected by the mock backend to demonstrate the SSE folio flip.\n\nThe real sidecar sends the same \`mail\` event over \`GET /events\` whenever the unread count changes.`,
            bodyFormat: "markdown",
            attachments: [],
            authentication: undefined,
            bodyTruncated: false,
          },
        };
        compiled.messages.set(id, row);
        inbox.total += 1;
        inbox.unread += 1;
        const unread = countUnread();
        const event: MailEvent = { unread, previous: lastUnread, ts: new Date().toISOString() };
        lastUnread = unread;
        callback(event);
      };
      timers.push(
        setTimeout(() => {
          arrival({
            subject: "Druckfreigabe für die Banner — können wir starten?",
            author: "Zeynep Aydın <zeynep@druckwerk-nk.de>",
            accountId: "account1",
          });
        }, 45_000),
      );
      timers.push(
        setTimeout(() => {
          arrival({
            subject: "[wernerstudio/atelier-api] Zeynep merged PR #412 into main",
            author: "GitHub <notifications@github.com>",
            accountId: "account1",
          });
        }, 120_000),
      );
      return () => {
        for (const timer of timers) clearTimeout(timer);
      };
    },
  };
}
