import { describe, expect, it } from "vitest";
import { countRemoteImages, extractAttachment, isTrackingPixel, parseMimeParts } from "../src/api/mime";

/** A minimal RFC 822 message with one base64 attachment whose filename is
 *  RFC 2047 encoded — the client-side export/download path. */
const RAW = [
  "Message-ID: <m-1@studio.example>",
  "Subject: Rechnung",
  'Content-Type: multipart/mixed; boundary="BOUND"',
  "",
  "--BOUND",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Siehe Anhang.",
  "--BOUND",
  'Content-Type: application/pdf; name="=?UTF-8?Q?Rechnung=5F24816=2Epdf?="',
  "Content-Disposition: attachment; filename*=UTF-8''Rechnung%5F24816%2Epdf",
  "Content-Transfer-Encoding: base64",
  "",
  "JVBERi0xLjQKJUNsb3NlZCBvbiB0aGUgbWFzdGVy",
  "--BOUND--",
].join("\r\n");

describe("client-side MIME extraction (export/download tier)", () => {
  it("parses the multipart tree", () => {
    const parts = parseMimeParts(RAW);
    expect(parts.length).toBeGreaterThanOrEqual(2);
  });

  it("extracts the attachment by its RFC 2047 filename, bytes intact", () => {
    const bytes = extractAttachment(RAW, "Rechnung_24816.pdf");
    expect(bytes).not.toBeNull();
    const text = new TextDecoder().decode(bytes!);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
  });

  it("returns null honestly for an unknown filename (no corrupt bytes)", () => {
    expect(extractAttachment(RAW, "does-not-exist.zip")).toBeNull();
  });
});

describe("remote-image consent gate", () => {
  it("counts only http(s) images in the body", () => {
    const html = `<p>Hi</p><img src="https://x.example/a.png"><img src="http://y.example/b.png"><img src="data:image/png;base64,AAAA">`;
    expect(countRemoteImages(html)).toBe(2);
  });

  it("flags ≤2px images as tracking pixels even when allowed", () => {
    const img = new Image();
    img.src = "https://track.example/pixel";
    img.setAttribute("width", "1");
    img.setAttribute("height", "1");
    expect(isTrackingPixel(img)).toBe(true);
  });

  it("a normal image is not a tracking pixel", () => {
    const img = new Image();
    img.src = "https://x.example/photo.png";
    img.setAttribute("width", "640");
    img.setAttribute("height", "480");
    expect(isTrackingPixel(img)).toBe(false);
  });
});
