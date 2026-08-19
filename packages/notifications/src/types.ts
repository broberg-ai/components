// @broberg/notifications — F074.
//
// THE ONE THING TO UNDERSTAND BEFORE CHANGING ANYTHING HERE: this package does
// not own the count. It owns the *choreography* around it.
//
// cardmem and xrt81 independently exclude a user's MUTED kinds from the badge
// count, so "unread" and "counted" are not the same set. Measured on cardmem's
// production 2026-08-18, one live user had raw_unseen=50 against a shown count
// of 1 — a core built on `count = rows WHERE seen IS NULL` would have put 50 on
// that user's home screen, permanently red with a kind they had switched off.
// So the count query stays with the consumer, in `store.countUnseen`, and what
// this package guarantees is that EVERY mutation recounts through that single
// function and announces the result.

/** One notification, as the fleet agrees to name it.
 *
 *  `title` / `body` / `navigate` are deliberately the exact three fields
 *  `@broberg/webpush`'s buildPayload reads, so the same names run the whole
 *  length of the pipe. A consumer once passed its own field names into that
 *  boundary and every message would have arrived EMPTY; four mutations survived
 *  it, because the tests read the send() return value and never the body on the
 *  wire. Identical names end to end makes that impossible rather than tested.
 *
 *  Extend it structurally — cardmem adds `projectId`, moovyy a poster — and
 *  nothing here needs to change. */
export interface NotificationRow {
  id: string;
  /** The app's own category. An UNKNOWN kind must still count: nothing is
   *  hidden because a label mapping was forgotten. */
  kind: string;
  title: string;
  body: string | null;
  /** Where tapping it takes you. See the counting rule in the README: count a
   *  row only if somewhere exists that CLEARS it. */
  navigate: string | null;
  /** The thing this notification is ABOUT, so reading that thing elsewhere in
   *  the app can clear the notification about it (`markSeenByRef`). Nothing
   *  fails without it — the bell just keeps promising something already read. */
  refId: string | null;
  /** Epoch ms. */
  createdAt: number;
  /** Epoch ms, or null for unseen. */
  seenAt: number | null;
}

/** Your database, behind five methods. Each `mark*` returns the ids whose
 *  `seenAt` **transitioned from null on this call** — never the ids requested.
 *  A row already seen, and a row belonging to somebody else, are both absent. */
export interface NotificationStore<Row extends NotificationRow = NotificationRow> {
  insert(subjectId: string, row: Row): Promise<void>;
  /** THE one counting place. Your SQL, your filters — including the muted-kind
   *  exclusion, which is why this is yours and not ours. */
  countUnseen(subjectId: string): Promise<number>;
  markSeen(subjectId: string, ids: readonly string[]): Promise<string[]>;
  markAllSeen(subjectId: string): Promise<string[]>;
  markSeenByRef(subjectId: string, kinds: readonly string[], refId: string): Promise<string[]>;
}

export interface NotificationsConfig<Row extends NotificationRow = NotificationRow> {
  store: NotificationStore<Row>;
  /** Called after EVERY mutation, with the recounted number. This is where a
   *  consumer fans out — cardmem to SSE *and* a silent push, the others to the
   *  silent push alone. It is REQUIRED on purpose: it is the enforcement of
   *  "the badge and the list change together", and an optional one would make
   *  the guarantee a suggestion. */
  onCountChanged: (subjectId: string, count: number) => void | Promise<void>;
  /** Where a FAILED fan-out goes (0.2.0). The mutation has already happened, so
   *  it stands; only the announcement failed, and the two are different facts.
   *
   *  Optional, and its absence is not silence: without it the failure goes to
   *  `console.error`. A swallowed one would leave the badge and the list
   *  disagreeing with nobody told — which is the defect this package exists to
   *  prevent, moved into the package itself. */
  onCountChangedError?: (err: unknown, subjectId: string, count: number) => void;
}

/** What a clearing call gives back.
 *
 *  `clearedIds` EXISTS EXACTLY ONCE. The rows are seen afterwards, so a second
 *  call returns an empty set — there is no way to ask for it again. A surface
 *  that highlights "what just cleared" must hold this for the visit; re-deriving
 *  it per render loses everything after the first tap. That is a contract, not
 *  a tip. */
export interface ClearResult {
  clearedIds: string[];
  count: number;
}
