// ABOUTME: Per-turn provenance diagnostic carrying usage sources and the modeled stop reason.
// ABOUTME: diagnostics[] is the only structured channel out of streamKiro, which never rejects.

import type { AssistantMessageDiagnostic } from "@earendil-works/pi-ai";
import type { KiroUsageProvenance } from "./token-usage.js";

/**
 * Diagnostic `type` for the per-turn provenance record.
 *
 * Stable string: kermes matches on it. Distinct from `kiro_api_error`, which
 * records a failed turn's typed HTTP classification — this one records a turn
 * whose numbers settled, and is the success record rather than a note attached
 * to one.
 */
export const KIRO_TURN_PROVENANCE_DIAGNOSTIC = "kiro_turn_provenance";

/**
 * How the `stopReason` this provider emitted was arrived at.
 *
 * - `modeled` — `MetadataEvent.stopReason` arrived on the wire and the emitted
 *   value reflects it.
 * - `inferred` — reconstructed locally from emitted tool calls and whether a
 *   contextUsage event arrived. Usually right, but a guess.
 */
export type KiroStopReasonSource = "modeled" | "inferred";

/**
 * Wire `StopReason` values whose meaning is not recoverable from the stop
 * reason pi ends up emitting.
 *
 * Source of truth: `StopReason` in the generated Smithy client for the same
 * service (`@amzn/kiro-runtime-service-typescript-client`).
 */
export const KIRO_MODELED_STOP_REASONS = {
  /**
   * Context overflow delivered as a *successful* stop reason.
   *
   * It arrives on a 200 with no error body, so the prose-matching
   * `isContextOverflow()` path never sees it and the turn looks like a normal
   * completion that simply stopped early. A consumer that needs to compact has
   * to read this field to find out.
   */
  contextWindowExceeded: "MODEL_CONTEXT_WINDOW_EXCEEDED",
  /** The wire origin of pi 0.83.0's `"pending"`; earlier peers have no slot for it. */
  pauseTurn: "PAUSE_TURN",
} as const;

/**
 * True when the modeled stop reason says the context window overflowed.
 *
 * Exported so consumers share this judgement instead of re-deriving it from a
 * raw string, and so the distinction survives the fact that pi's emitted
 * `stopReason` has no member for it.
 */
export function isModeledContextOverflowStopReason(rawStopReason: string | undefined): boolean {
  return rawStopReason === KIRO_MODELED_STOP_REASONS.contextWindowExceeded;
}

/** Stop-reason facts recorded for a turn. */
export interface KiroStopReasonRecord {
  /** The value this provider actually emitted on the message. */
  emitted: string;
  /** How {@link emitted} was arrived at. */
  source: KiroStopReasonSource;
  /** `MetadataEvent.stopReason`, verbatim, when the service sent one. */
  modeled?: string;
  /** `MetadataEvent.stopDetails`, verbatim, when the service sent one. */
  details?: Record<string, unknown>;
  /**
   * Set only when the modeled stop reason reports a context overflow. Present
   * because that case is otherwise invisible: it rides a successful turn.
   */
  contextOverflow?: true;
}

/** Inputs for the per-turn provenance diagnostic. */
export interface KiroTurnProvenanceInput {
  /**
   * Provenance recorded by `finalizeKiroUsage`. Read rather than recomputed —
   * that function owns the measured/derived/estimated precedence, and a second
   * classifier here would be free to disagree with the numbers it describes.
   */
  usage?: KiroUsageProvenance;
  /** The stop reason this provider emitted. */
  stopReason: string;
  /**
   * How {@link stopReason} was produced, supplied by the code that produced it.
   *
   * Deliberately not inferred from {@link rawStopReason} being present: the
   * service can send a modeled stop reason that the emitted value does not yet
   * follow, and reading presence as authorship would report the emitted value
   * as measured when it was still a local guess.
   */
  stopReasonSource: KiroStopReasonSource;
  /** `MetadataEvent.stopReason`, when one arrived. */
  rawStopReason?: string;
  /** `MetadataEvent.stopDetails`, when it arrived. */
  stopDetails?: Record<string, unknown>;
}

/**
 * Build the per-turn provenance diagnostic.
 *
 * Constructed as a literal rather than through pi-ai's
 * `createAssistantMessageDiagnostic`, which routes its second argument through
 * `extractDiagnosticError` unconditionally — passing `undefined` there yields a
 * bogus `error: { name: "ThrownValue", message: "undefined" }` on a record that
 * describes a successful turn. `kiro_api_error` uses the helper correctly
 * because it always has a real error to pass.
 *
 * Absent optional fields are omitted rather than written as null, so a consumer
 * can distinguish "the service never said" from "the service said nothing".
 */
export function createKiroTurnProvenanceDiagnostic(input: KiroTurnProvenanceInput): AssistantMessageDiagnostic {
  const stopReason: KiroStopReasonRecord = {
    emitted: input.stopReason,
    source: input.stopReasonSource,
    ...(input.rawStopReason !== undefined ? { modeled: input.rawStopReason } : {}),
    ...(input.stopDetails !== undefined ? { details: input.stopDetails } : {}),
    ...(isModeledContextOverflowStopReason(input.rawStopReason) ? { contextOverflow: true as const } : {}),
  };
  return {
    type: KIRO_TURN_PROVENANCE_DIAGNOSTIC,
    timestamp: Date.now(),
    details: {
      ...(input.usage !== undefined ? { usage: input.usage } : {}),
      stopReason,
    },
  };
}
