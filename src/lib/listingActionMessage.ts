// The sentence a seller reads when a listing write is refused.
//
// AppStore throws a CODE, never a message, because the only text the
// database hands back is a PostgREST diagnostic in English ("permission
// denied for column batch_parked") -- useless under an Arabic interface,
// and not what the seller needs to know anyway, which is whether anything
// was saved and whether pressing the button again is worth it. The
// diagnostic goes to the console, where it names the column or constraint
// that refused; this turns the code into the seller's own language.
//
// Extracted because four of these sites were writing `e?.message ||
// t(...)`, which put the diagnostic on screen in exactly the case it was
// least readable -- the one where something actually went wrong -- while
// two more hand-rolled the same code ternary and the rest used a bare
// `catch {}` that could not tell a signed-out seller anything useful.
//
// 'not-signed-in' gets its own sentence on purpose: it is the one failure
// the seller can do something about, and telling them to try again would
// send them round the same loop forever.
export function listingActionMessage(
  e: any,
  t: (key: string) => string,
  fallbackKey: string
): string {
  if (e?.code === 'not-signed-in') return t('createListing.postFailedSignedOut');
  // Same reasoning, second case: a status the database put back is not
  // something a second tap fixes, so it must not be dressed up as
  // "please try again".
  if (e?.code === 'needs-review') return t('myListings.needsReviewFailed');
  return t(fallbackKey);
}
