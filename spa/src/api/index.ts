/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Backend factory: VITE_BACKEND=mock|real selects the implementation.
 * Dev defaults to the demo register; production builds talk to the sidecar.
 */

import type { MailBackend } from "./backend-interface";
import { createMockBackend } from "./mock-backend";
import { createRealBackend } from "./real-backend";

export type { MailBackend } from "./backend-interface";
export type {
  MessageRef,
  MessagePatch,
  UpdateResult,
  CreateFolderResult,
  BodyChunk,
  ComposeTarget,
  DraftFields,
  DraftResult,
  Recipient,
} from "./backend-interface";
export { BackendError, ACCOUNT_PALETTE_SIZE } from "./real-backend";
export type * from "./types";

function resolveMode(): "mock" | "real" {
  const raw = (import.meta.env.VITE_BACKEND ?? "").toLowerCase();
  if (raw === "mock" || raw === "real") return raw;
  return import.meta.env.DEV ? "mock" : "real";
}

let instance: MailBackend | null = null;

export function getBackend(): MailBackend {
  if (!instance) {
    instance = resolveMode() === "mock" ? createMockBackend() : createRealBackend();
  }
  return instance;
}

export function backendKind(): "mock" | "real" {
  return getBackend().kind;
}
