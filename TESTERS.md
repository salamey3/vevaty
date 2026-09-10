# The tester round

Written 10 Sep 2026, when sign-up became something an admin can shut. The
mechanics live in the database (the `tester_*` migrations of 10 Sep) and in
`AuthScreen`, `ReportProblemHost` and the two admin screens; this is the
record of why they are shaped the way they are.

## What the round is

A small group of people, recruited by name, using the real app against the
real database before anyone else can sign up. Each of them is tagged with
the roles they were asked to play — seller, storefront, buyer, consignor —
and three things follow from the tag:

- **Everything they post marks itself** (`listings.is_test`, set by the
  `mark_test_listing` trigger), so the whole round can be found and removed
  on the last day instead of being picked out by hand.
- **A "Report a problem" tab appears** on the edge of every screen.
- **They show up in Admin → Tester centre**, with their listings and
  reports counted.

## The switch

`site_settings.registration_open`, flipped from the Tester centre. It is
**open by default**, so nothing changes for anyone until the day the first
invites go out and it is switched to invite-only.

Shut, it means exactly one thing: **a new account cannot become a member
without a claimed invite.** People who already have an account are not
affected in any way — they sign in, post and chat as before. Someone
without an invite is shown an invite-only message and one button, "Tell me
when it opens", which puts the number they already typed on the waitlist.
Nothing is sent to that number now; it is a list to contact on launch day.

Admins are exempt from the rule, so an admin can never lock themselves out
of their own platform with it.

## Where the wall actually is

In `myazar.upsert_own_profile` — the only way an account makes itself a
member — and nowhere else. (An admin can also let someone in; see "When
someone gets stuck".) It refuses with `VV002 invite_required` while sign-up
is shut and the account has claimed no invite. Everything the app does
before that is for the person's sake, not the rule's:

- The phone step reads the switch fresh, together with "is this number
  registered?", instead of trusting a value from launch.
- The form asks again **right before the text message**, because that is
  the step that costs money — $0.36 to Lebanon — and sign-up can be shut,
  or the code used or cancelled, while the form is being filled in. A
  refusal there sends them back to the invite step with nothing spent.
- The invite is claimed **before** the profile write, since the claim is
  what the server looks for.

If the server still refuses (the switch flipped in the last second), the
number is verified, the account exists, and the repair step asks for a
code rather than failing the same way every time Finish is pressed.

The claim itself burns the code (`used_at`), on a completed OTP and never
on typing it — a tester who types the code and wanders off before the text
arrives must not have spent it. A code stays spent even if the account
that used it is later deleted (`used_by` empties on delete, `used_at` does
not), and the same person redeeming their own code again — a reinstall,
moving from the website to the app — works but never rewrites their roles,
which by then are the admin's to change.

## What membership now buys, and why that had to change too

`profiles.is_phone_verified` has always meant "a verified member". Until
this round it gated almost nothing on the server: posting a listing,
starting a chat and seeing a seller's number needed only a non-anonymous
session — and a script can get one of those from the auth API without ever
seeing the invite step. An invite rule that one API call walks around is
not a rule, so those three now need a member:

- `listings` INSERT — restrictive policy "only members can create listings"
- `chat_threads` INSERT — "only members can start conversations"
- `get_seller_phone` / `get_seller_contact`

And membership is only ever made by the server. `authenticated` holds
table-level INSERT/UPDATE on `profiles`, so a browser console could simply
set `is_phone_verified`, give itself `tester_roles`, or lift its own
suspension. `guard_profile_membership_columns_trg` refuses all three from
any client session, an admin's included — every admin change goes through a
function that writes `admin_actions`. Becoming a member also needs
`auth.users.phone_confirmed_at` — set by the OTP and by nothing a client can
write — which closed a second route: an email-and-password account was a
"member" the moment it asked. And the flag only ever goes up: lowering it
was the way to "become" a member a second time and have an invite's roles
copied back over an admin's untag.

`tester_roles` has no SELECT grant and must never get one: `profiles` is
readable by everyone on every row, so a grant would publish who is in the
round. The app reads its own through `my_tester_status()`, which refuses a
request with no session rather than answer "no roles" — a lost session is
"we do not know", and "not a tester" would hide the tab.

Their listings are another matter: `listings.is_test` is readable with the
rest of a listing, so anyone who looks can tell which live listings are test
ones, and whose. Accepted for the round; hiding it would mean re-granting
`listings` column by column.

## The invite code

Six characters from an alphabet with no 0/O, 1/I/L — read off a WhatsApp
message and typed by hand, so case, spaces and dashes are ignored
everywhere (`normalize_invite_code`). The admin's "Send invite" writes the
message in English and Arabic.

**Links only reach the website** (`vevaty.com/login?invite=CODE`, which
fills the code in and skips the step). The app cannot open links: that
needs an `app.json` change, which is a fingerprint input and therefore a
new native build (see @AGENTS.md). App testers type the code. While sign-up
is open the form has a folded-away "Have an invite code?" box for exactly
that, or they would sign up untagged.

## Report a problem

A slim dark tab, a little below the middle of the right edge (left in
Arabic), on every screen, for tagged testers and admin accounts only. It is
mounted once at the app root rather than on any screen, because the point
is to be reachable from exactly where something broke.

The tester writes what happened and picks how bad it was — it stopped me,
it annoyed me, just an idea. **Everything else is recorded for them**,
because a one-line report is only actionable with it: the screen, the
listing if they were on one, the platform, OS version and phone model, the
app language, and the runtime version and update id — the same update the
build stamp on Profile shows, so a report can be tied to the exact ship
that caused it. Route params are not copied wholesale; only a listing id
is kept, and only if it is a real uuid.

A screenshot is optional. One that will not upload is dropped rather than
allowed to cost the report, and the tester is told; a Send retried after a
failure reuses the copy already uploaded. It is stored like a listing
photo — at a public, unguessable URL — so it should not be used for
anything they would not post. The server keeps the address only if it is on
the app's own image CDN, because the inbox loads it and opens it on tap.

Everything the sheet says is said inside it. A React Native Modal is its
own window, and an Alert fired from inside one can open underneath it and
never be seen.

The server refuses anyone untagged, and more than 30 reports an hour. The
admin inbox (Admin → Problem reports) marks each one new, seen, fixed or
won't fix.

## When someone gets stuck

The one way an invited person ends up half-in: their number verified, but
the profile write was refused because the claim never happened — the
connection dropped at that exact moment and the app was closed before the
repair step. The app shows them signed in, and the server refuses them
posting, chatting and seeing numbers.

- **The app repairs it on the next launch when it can.** A signed-in phone
  account whose profile is not a member retries the write
  (`AppStore.repairMembership`). The server decides, so this only succeeds
  where the sign-up itself would have — while sign-up is open, or once they
  have an invite.
- **An admin can let them in directly.** Tester centre → "Tag someone who
  already has an account", with their number: any account that has
  confirmed that number by text message is made a member and tagged, and
  the log records it as `admit_member`. That is what an invite is, minus the
  code.

## Known gaps

- **The tab is hidden on iOS native-modal screens.** A screen presented
  with `presentation: 'modal'` is drawn above the whole root layer on iOS.
  Android and the website are unaffected, and the first round has no
  iPhone testers.
- **`is_test` can be switched off by the listing's own seller.**
  `authenticated` holds table-level UPDATE on `listings`, and nothing
  guards the column. No screen writes it, so only a tester deliberately
  calling the API could — but the end-of-round clean-up trusts it. A guard
  trigger in the style of `guard_posting_points_awarded` closes it; it was
  left out of this change because it sits on every listing update.
- **The admin MFA policies do less than their name says.** The restrictive
  "admin identity requires mfa" policy counts rows in `auth.mfa_factors`,
  whose rows a signed-in session cannot see — so the count is always zero
  and aal1 is accepted. And the `admin_*` functions check `myazar.admins`,
  never the session's `aal`. Both predate this round; both are in
  @NEXT.md.
- **Codes can be guessed, slowly.** `check_tester_invite` answers anyone,
  with no rate limit, over 31⁶ (about 887 million) codes. A guessed code
  still needs a real phone to claim, and the prize is a tester account.
- **The waitlist takes any well-formed number.** Nothing verifies it, and
  the three-a-day limit is per session, which is cheap to renew. It is a
  list to call, never a list anything is sent to automatically.
- **"Confirmed by the OTP" assumes the Auth setting agrees.** Supabase
  sets `phone_confirmed_at` without a text message if phone confirmation
  is switched off for sign-ups. Worth one look in the dashboard.
- **Nobody on the waitlist is told anything automatically.** There is no
  push and no free message channel yet (see @LIFECYCLE.md). On launch day
  the list is copied out of the Tester centre ("Copy all") and contacted by
  hand.
