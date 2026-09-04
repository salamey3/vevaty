# Media: uploading it, writing it, and only then publishing

The reasoning record for the 3 September incident and the work that came
out of it. @AGENTS.md carries the rules in their short form -- "Publish
only once the media has landed", "A request that never answers is not an
error", "One alert, ranked" -- and this is why they say what they say.

## What happened

A seller posted "Unfurnished Apartment with City View - Marble Flooring"
and it appeared on the site with no pictures. He got pictures onto it by
opening the listing, tapping Edit, and uploading the same photos a second
time. He asked us to find out why, and to make sure it could not happen
anywhere else.

The edge-function logs had the whole thing. Three listings were posted in
nine minutes. `moderate-listing` — which is what sets a listing `active`
— ran about four seconds after each insert. The photo rows for the first
landed at +19 seconds and for the second at +14. For the third they never
landed at all.

That is not a race that was lost occasionally. Moderation answered in
four seconds and six photos took ten to twenty, so **every listing on the
site had been publicly visible with no pictures for ten seconds or more**,
and any listing whose upload did not finish — a closed tab, a reload, a
backgrounded browser tab throttled by the OS, a dropped connection — was
live and empty permanently. Nothing anywhere reported it. `addListing`
ended its upload chain with `.catch(() => {})`.

## The shape of the fix

**Media first, publication second.** `addListing` now waits for the photo
rows before it calls moderation at all. A listing whose media did not
land stays at `pending_review`, which is invisible to buyers — a listing
nobody can see yet is a far better failure than a live one with nothing in
it.

**Publication needs positive evidence, not the absence of a failure.**
With no photos at all the media step succeeds instantly having done
nothing, and "nothing went wrong" then reads as "publish". Both create and
edit check the photo count itself. This was not hypothetical: the wizard's
step gate guards the Continue button, and "Save & exit" goes round it.

**Parking has to be reversible.** `updateListing` re-runs moderation for a
listing sitting at `pending_review`. The gate is written as a single
exclusion — anything but `moderation_status = 'flagged'`, which belongs to
a human moderator — and that phrasing is the third attempt. Listing the
states worth releasing instead missed `'rejected'` (what a resubmit leaves
behind, because `enforce_listing_moderation_gate` silently keeps the old
value), then missed `'ai_approved'` (what hide-then-resubmit leaves
behind, same trigger). Each miss was a listing invisible for ever with no
route back short of an admin.

**The rule holds server-side.** Three things can set a listing `active`:
`moderate-listing`, `republish_own_listing`, `restore_auto_hidden_listing`.
All three now refuse a listing with no `kind='gallery'` row. Guarding only
the client left two routes open that needed no failed write at all — let a
listing expire, strip its photos through "Save & exit", press Republish;
or let buyers auto-hide it, strip it as a draft, press Restore. The client
checks stayed, because they are what gives the seller a sentence they can
act on, but they are not what holds.

## The audit around it

The bug was one instance of a pattern, so the change went looking for the
rest. Everything below was a write that reported success and changed
nothing, or a failure nobody would ever have learned about:

- `persistNewPhotos` inserted photo rows without checking the error, so a
  refused insert updated local state as though the rows existed. The
  seller's own device showed photos nobody else had — which is how "my
  listing has no pictures" reaches us as a bug report instead of an error.
- The gallery delete, the sort-order resync and the spin-set replace all
  dropped their errors. A refused delete meant a photo the seller removed
  stayed public; a refused resync meant the buyer's cover never moved.
- `attachVideoToListing` could not fail. RLS shows an unattached clip to
  its seller and nobody else, so the seller watched their own video on
  their own listing while no buyer could.
- `updateAvatar`, `updateProfileName` and `updateProfileDistrict` had no
  `.select()` and no rollback. `ChangePhoneScreen` wrote `profiles.phone`
  blind, after the OTP was already spent — so the seller could read
  "Phone changed" while every buyer who tapped Show number still got the
  old one.
- `awardPoints` wrote the balance and the ledger row with unread errors.
- `AdminModerationScreen`'s status patch did not read back what the
  moderation-gate trigger had actually done with it.
- Moderators could not see the media they were moderating at all:
  `listing_photos`, `listing_spin_sets` and `listing_videos` had no admin
  RLS policy, so anything not `active` and not their own came back empty.

## Two things that were not obvious

**A request that never answers is not an error.** Nothing in the transport
times out on its own, so a socket that goes quiet leaves a promise pending
and no `catch` runs. Irrelevant while every write was fire-and-forget;
load-bearing the moment three screens started waiting on a media save
before letting the seller move on. The deadline went on the Supabase
client, once. Two details there were each wrong first, and both were
web-only, which is the sort that ships: `AbortSignal.timeout` aborts with
a `TimeoutError` that postgrest-js retries three times, turning a
45-second bound into 187; and clearing the timer when the fetch promise
settles disarms it at the response HEADERS, leaving a stalled body read
unbounded. Measured, both times, rather than reasoned about.

**One alert, ranked.** `AlertHost` holds exactly one alert and has no
queue, so every path that can produce two problems has to collect them and
say one sentence. Getting this wrong is invisible in testing and obvious
to a seller: the message that mattered ("this is not on the site") kept
losing to the one that did not ("the video was not attached").

## Points, while we were in there

Posting points moved into `claim_posting_points`, a SECURITY DEFINER RPC
doing the claim flag, the ledger row and a RELATIVE balance increment in
one transaction. Three reasons:

1. The old code wrote an ABSOLUTE total computed on the device. Twenty
   items posted at once each wrote a total from before the others landed,
   and the next sync pulled the survivor back over the local one — the
   seller watched +300 arrive and had +45 the next morning.
2. It credited every non-draft the moment the row was written, including
   the ones the same function then refused to publish.
3. Whether a listing had already been credited was inferred from the
   status it happened to be in. `listings.posting_points_awarded` is the
   fact instead, and a trigger stops the beneficiary resetting it — a
   column-level REVOKE could not, because the table carries a table-level
   UPDATE grant.

## The deployment order

The database and the edge function are already live; the app is a patch.
That gap is real for as long as an older build is running — a phone that
has not updated, a web bundle still cached — and it points the wrong way
if you are not careful. `moderate-listing`'s photo check, deciding on its
first read, would have turned "published with no photos" into "never
published at all" for every listing posted from an older build, whose
uploads are still in flight four seconds after the insert. And that build
has no repair path: the re-moderation branch is part of this patch.

So the check WAITS — up to six reads five seconds apart, which is the ten
to twenty seconds six photos actually take. A client that already waited
finds the rows on the first read and pays nothing. Worth remembering
generally: a server-side rule added ahead of the client that satisfies it
has to be written for the client that does not yet.

## What is deliberately still open

See @NEXT.md: `anon` cannot read `myazar.listings` at all (a restrictive
MFA policy's subquery touches a table `anon` has no grant on — invisible
today because the app signs everyone in anonymously first); two
`updateListing` calls on one listing can still double-insert photos; and
`profiles.points` is still directly UPDATE-granted to `authenticated`.
