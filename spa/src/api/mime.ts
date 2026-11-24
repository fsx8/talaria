/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Client-side MIME part extraction (Stage 2): the sidecar exposes the raw
 * RFC 2822 source (`getMessage rawSource`), but no per-attachment content
 * route — so the browser assembles the paged raw source and cuts the wanted
 * MIME part out itself. Deliberately small and forgiving: it only needs to
 * handle what real mail clients actually emit (multipart trees, base64 or
 * quoted-printable leaf parts), and it refuses anything it cannot do
 * honestly instead of returning corrupt bytes.
 */

export interface RawPart {
  /** Lower-cased header name → raw (unfolded) header value. */
  headers: Map<string, string>;
  /** The raw body text of this part (undecoded). */
  body: string;
}

/** Decode bytes as UTF-8, tolerating stray invalid sequences. */
export function bytesToText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/** Encode text as latin-1 byte-for-byte (raw 7/8-bit part bodies). */
function textToLatin1Bytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** Split a raw header block into a map, unfolding continuation lines. */
function parseHeaders(block: string): Map<string, string> {
  const headers = new Map<string, string>();
  const unfolded = block.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const sep = line.indexOf(":");
    if (sep <= 0) continue;
    const name = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();
    if (name && !headers.has(name)) headers.set(name, value);
  }
  return headers;
}

/** A tolerant parameter read: `name="x"; filename=y` → value for `key`. */
function headerParam(value: string, key: string): string | null {
  const re = new RegExp(`${key}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, "i");
  const match = value.match(re);
  if (!match) return null;
  return (match[1] ?? match[2] ?? "").trim() || null;
}

/** Recursively walk a MIME tree, collecting every leaf part. */
function collectParts(headers: Map<string, string>, body: string, out: RawPart[]): void {
  const contentType = headers.get("content-type") ?? "text/plain";
  const boundary = contentType.toLowerCase().includes("multipart")
    ? headerParam(contentType, "boundary")
    : null;
  if (!boundary) {
    out.push({ headers, body });
    return;
  }
  // Split on the boundary lines; the preamble and epilogue fall away.
  // The closing delimiter may be the body's last line (no trailing newline).
  const segments = body.split(new RegExp(`^--${escapeRegExp(boundary)}(?:--)?[ \\t]*(?:\\r?\\n|$)`, "m"));
  for (const segment of segments) {
    if (!segment || /^\s*$/.test(segment)) continue;
    const sep = segment.search(/\r?\n\r?\n/);
    if (sep < 0) continue;
    const partHeaders = parseHeaders(segment.slice(0, sep));
    const partBody = segment.slice(sep).replace(/^\r?\n\r?\n/, "").replace(/\r?\n$/, "");
    collectParts(partHeaders, partBody, out);
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Parse a full RFC 2822 message into its flat leaf-part list. */
export function parseMimeParts(raw: string): RawPart[] {
  // IMAP sources are CRLF; normalize once so boundary lines split cleanly
  // on every platform (a stray \r otherwise leaks into leaf bodies and
  // corrupts base64 decoding).
  raw = raw.replace(/\r\n/g, "\n");
  const sep = raw.search(/\r?\n\r?\n/);
  if (sep < 0) return [];
  const headers = parseHeaders(raw.slice(0, sep));
  const body = raw.slice(sep).replace(/^\r?\n\r?\n/, "");
  const parts: RawPart[] = [];
  collectParts(headers, body, parts);
  return parts;
}

/** Decode RFC 2047 encoded-words (=?charset?Q?...?=) in header values. */
function decodeEncodedWords(value: string): string {
  return value.replace(/=\?([^?]+)\?([qQbB])\?([^?]*)\?=/g, (_all, charset, enc, text) => {
    try {
      if (enc.toLowerCase() === "b") {
        return new TextDecoder(charset, { fatal: false }).decode(base64ToBytes(text));
      }
      const qp = text
        .replace(/_/g, " ")
        .replace(/=([0-9A-Fa-f]{2})/g, (_h: string, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      return new TextDecoder(charset, { fatal: false }).decode(textToLatin1Bytes(qp));
    } catch {
      return text;
    }
  });
}

/** Is this leaf part an attachment (or an inline attachment with a filename)? */
function partFilename(part: RawPart): string | null {
  const disposition = part.headers.get("content-disposition") ?? "";
  const contentType = part.headers.get("content-type") ?? "";
  const fromDisposition = /attachment/i.test(disposition) ? headerParam(disposition, "filename") : null;
  const fromType = headerParam(contentType, "name");
  const raw = fromDisposition ?? fromType;
  return raw ? decodeEncodedWords(raw) : null;
}

/** Decode a leaf part body per its Content-Transfer-Encoding. */
function decodePart(part: RawPart): Uint8Array {
  const encoding = (part.headers.get("content-transfer-encoding") ?? "").toLowerCase().trim();
  if (encoding === "base64") {
    return base64ToBytes(part.body.replace(/[^A-Za-z0-9+/=]/g, ""));
  }
  if (encoding === "quoted-printable") {
    const decoded = part.body
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    return textToLatin1Bytes(decoded);
  }
  // 7bit / 8bit / binary / unknown: take the bytes as they come.
  return textToLatin1Bytes(part.body);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Extract one attachment's bytes from a raw RFC 2822 message. Matches by
 * filename (Content-Disposition/type name parameter). Returns null when no
 * part carries that filename — callers surface an honest error, never
 * corrupt bytes.
 */
export function extractAttachment(raw: string, filename: string): Uint8Array | null {
  const parts = parseMimeParts(raw);
  const wanted = filename.trim().toLowerCase();
  for (const part of parts) {
    const name = partFilename(part);
    if (name && name.trim().toLowerCase() === wanted) return decodePart(part);
  }
  // Second pass: unique basename match (pathed filenames happen).
  for (const part of parts) {
    const name = partFilename(part);
    if (name && name.split(/[\\/]/).pop()?.trim().toLowerCase() === wanted) return decodePart(part);
  }
  return null;
}

/** Count remote (http/https/protocol-relative), non-pixel images in HTML. */
export function countRemoteImages(html: string): number {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    let count = 0;
    for (const img of doc.querySelectorAll("img")) {
      const src = img.getAttribute("src") ?? "";
      if (!/^(https?:)?\/\//i.test(src.trim())) continue;
      if (isTrackingPixel(img)) continue;
      count += 1;
    }
    return count;
  } catch {
    return 0;
  }
}

/** True for tracking-pixel-sized images (declared ≤2px in attr or style). */
export function isTrackingPixel(img: HTMLImageElement): boolean {
  const dim = (value: string | null): number => {
    if (!value) return 0;
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const width = Math.max(dim(img.getAttribute("width")), dim(img.style.width));
  const height = Math.max(dim(img.getAttribute("height")), dim(img.style.height));
  return width > 0 && width <= 2 && height > 0 && height <= 2;
}
