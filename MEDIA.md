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

## The check believed its caller

Written 16 Sep 2026, and it is the same mistake as the 3 September one
seen from the other end. That one published a listing before its media
had landed. This one checked a listing that was never the listing.

`moderate-listing` is the only thing in the system that sets a listing
`active`. Until version 16 it was called like this:

```
triggerListingModeration(listingId, photos, title, description)
```

— and it judged the title, the description and the photos **out of the
request body**, using the id for nothing but the row it wrote the verdict
to. Every one of those four arguments came from the caller. Three holes
follow from that one sentence, and they are worth separating because they
need different guards.

**What was checked and what was published were two different things.**
This is the whole of it. A seller could post one listing and have another
one checked — clean photos and innocuous text in the body, whatever they
liked in the row — and the function would approve the row it had never
looked at. Nothing about this needed any skill: it is one API call with a
different JSON body, against an endpoint the app itself calls on every
post.

**A moderator's verdict could be overturned.** The function re-ran on
whatever it was given and wrote its own answer over the top, so a listing
a human had `flagged` could be handed back to the AI with a tamer payload
until it approved.

**It could be pointed at somebody else's listing.** Nothing checked that
the caller owned the row. And the read it did do used the caller's own
JWT, which reads "what can you see" rather than "what is stored" — on this
table the `active listings are publicly readable` policy qualifies as
`(status = 'active') OR (seller_id = auth.uid())`, so every visitor's
anonymous session can already read any live listing.

### The one guard that matters, and the four around it

**The call carries an id and nothing else.** That is the fix; everything
below is a consequence of it. The function reads the listing's own stored
title, description and photos and judges those, so "what was checked" and
"what was published" are the same row by construction rather than by
agreement between two pieces of code.

The rest are guards on *which* row, and each closes something the first
one does not:

- **The row is read with the service-role key**, not the caller's JWT.
  With the caller's key a merely readable listing is indistinguishable
  from an owned one, which is the third hole above; the point of the read
  is what is stored, so it has to be a read that sees what is stored.
- **The caller must be the seller, or an admin.** Membership in
  `myazar.admins`, deliberately, rather than `admin_session_active()` —
  the question here is not "may this person use an admin power" but "may
  they ask for a re-check of a listing that is not theirs", and the answer
  the check produces is about the stored row either way.
- **A human verdict is final.** `flagged` and `human_approved` are
  refused outright. Written as a block list, not an allow list, for the
  reason recorded above under "The shape of the fix": listing the states
  worth releasing has been wrong three times running here, and each miss
  was a listing invisible for ever. `rejected` is deliberately **not** on
  the list — that is the state a seller resubmitting has to be able to
  climb out of.
- **The listing must be at `pending_review`.** The only status a genuine
  call ever arrives with: `addListing` inserts there, and all three of
  `updateListing`'s re-moderation paths move the row there before calling.
  This one is load-bearing precisely because the function writes with the
  service-role key — `enforce_listing_moderation_gate` treats
  `request_role = 'service_role'` as privileged and returns `new`
  unchanged, so the trigger that guards every other route to `active`
  guards nothing here. Without the status check a seller could re-moderate
  their listing out of whatever state it was in; the database today holds
  two lots at `auction` and eight at `removed`, and pulling a lot out of a
  running sale by hand is not a thing anyone should be able to do.

### Two things this also fixed by accident

**The photos stopped being uploaded twice.** The old payload re-encoded
six gallery photos and two spin frames to base64 and sent them, on top of
the upload that had already put them on the CDN — from a phone, on a
Lebanese mobile connection. The function fetches the stored
`thumbnail_url` now (640px, and far inside the 3.5MB it will look at),
falling back to `url`.

**The spin sampling moved to the server, where it means something.** It
was the client picking which two frames the moderator would see. One
frame from each of up to two sets, at random rather than at a fixed
position — a spin is one object rotating, so its frames are near-identical
by construction and any one of them represents the set, but a fixed
position is a position a seller could learn to keep clean.

### The deployment order, again

The function went first and the app second, which is the opposite of what
it looks like it should be. Shipping the app first would have left the old
function judging listings on their text alone for as long as the gap
lasted — the app would have stopped sending photos to a function that
still expected them in the body.

Going the other way costs nothing, because the new function ignores the
old payload rather than rejecting it: an older build still sends photos, a
title and a description, they are dropped, and the listing is checked on
what is stored. That build keeps working through the photo wait it always
relied on. Same lesson as the one in "The deployment order" above, one
release later: **a server-side rule added ahead of the client that
satisfies it has to be written for the client that does not yet.**

### What this is not

It is not a reason to trust the AI pass more than before. It still reads
text a seller wrote, and a listing that talks to the model rather than to
a buyer is a prompt-injection attempt — the prompt says so, and says the
text is the thing being judged rather than an instruction. The guard
against that is the same one as ever: the function can only ever move a
listing from `pending_review` to `active` or to `flagged`, and everything
it is unsure about goes to a human.

## What is deliberately still open

See @NEXT.md: `anon` cannot read `myazar.listings` at all (a restrictive
MFA policy's subquery touches a table `anon` has no grant on — invisible
today because the app signs everyone in anonymously first); two
`updateListing` calls on one listing can still double-insert photos; and
`profiles.points` is still directly UPDATE-granted to `authenticated`.
