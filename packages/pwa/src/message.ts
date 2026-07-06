/**
 * The single source of the client↔service-worker "activate the waiting worker"
 * message. Both the client controller (`applyUpdate`) and the SW helper
 * (`listenForSkipWaiting`) import it so the contract can never drift.
 */
export const SKIP_WAITING = "SKIP_WAITING" as const;

export const SKIP_WAITING_MESSAGE = { type: SKIP_WAITING } as const;

export type SkipWaitingMessage = typeof SKIP_WAITING_MESSAGE;
