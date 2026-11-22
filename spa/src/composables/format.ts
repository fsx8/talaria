/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Display formatting: names, dates (agate tabular), sizes. */

export interface ParsedAddress {
  name: string;
  email: string;
}

/** Parse "Name <addr>" (or bare addresses) without ever trusting the input. */
export function parseAddress(raw: string): ParsedAddress {
  const match = raw.match(/^\s*("?)([^"<]*?)\1\s*<([^>]+)>\s*$/);
  if (match) {
    const name = (match[2] ?? "").trim();
    const email = (match[3] ?? "").trim();
    return { name: name || email, email };
  }
  const bare = raw.trim();
  if (bare.includes("@")) return { name: bare, email: bare };
  return { name: bare || "(unknown)", email: "" };
}

export function senderName(raw: string): string {
  return parseAddress(raw).name;
}

export function initials(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N} @.-]/gu, "")
    .split(/[\s@.-]+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0]!.slice(0, 2)).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: "short" });
export const dayMonthFormat = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const fullFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function listDate(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return timeFormat.format(date);
  const ageDays = (now.getTime() - date.getTime()) / 86_400_000;
  if (ageDays < 6) return dayFormat.format(date);
  return dayMonthFormat.format(date);
}

export function fullDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return fullFormat.format(date);
}

export function clockTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return timeFormat.format(date);
}

export function byteSize(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} kB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export function groupCount(n: number): string {
  return n.toLocaleString();
}
