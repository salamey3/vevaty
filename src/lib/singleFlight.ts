// Run this at most once at a time, and once more if anybody asked while it
// was running.
//
// The launch case it was written for: SettingsStore's first-mount effect
// and the auth listener's INITIAL_SESSION both ask for a settings refresh
// in the same tick, so the categories, domains, attributes and site
// settings were fetched twice and two admin checks overlapped. The
// overlapping checks are the part with teeth -- only the newer may write,
// so if the newer one's read fails while the older's succeeded, the answer
// that wins is "not an admin" and an admin reloading an admin page is
// shown the sign-in form.
//
// QUEUED RATHER THAN DROPPED, and that is the whole design. A plain "one
// at a time, ignore the rest" would be wrong here: the second caller may
// know something the first did not -- a sign-in that landed while the
// first fetch was already in the air -- so its request has to run, just
// afterwards rather than alongside. Everything that arrives during a run
// collapses into ONE re-run, so a burst of ten costs two passes, not ten
// and not one.
//
// What a caller gets back while one is in flight is the promise of the run
// ALREADY GOING, not of the re-run. That is right for a caller who only
// wants to know the data is being refreshed, and wrong for one that must
// see its own write reflected -- that caller has to start its own read,
// after its write, rather than joining this one. SettingsStore's admin
// save paths do exactly that.
export function singleFlight(run: () => Promise<void>): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  let queued = false;

  const request = (): Promise<void> => {
    if (inFlight) {
      queued = true;
      return inFlight;
    }
    const current = (async () => {
      try {
        await run();
      } finally {
        inFlight = null;
        if (queued) {
          queued = false;
          // Swallowed, and it has to be: NOBODY is awaiting this one. The
          // caller that queued it was handed the promise of the run that
          // was already going, so a rejection here reaches no catch at all
          // and surfaces as an unhandled rejection -- a red box in dev, and
          // noise in the log in production, for a refresh whose failure is
          // already survivable (the cached data stays). A caller's OWN
          // promise still rejects normally.
          void request().catch(() => {});
        }
      }
    })();
    inFlight = current;
    return current;
  };

  return request;
}
