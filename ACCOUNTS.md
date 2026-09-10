# What a Vevaty account is, and why

Written 1 Sep 2026, when registration became a real form instead of a
password box. The mechanics live in `AuthScreen.tsx`; this is the record of
why they are what they are, so that the next person to open that screen does
not undo a decision by accident.

## The phone number is the account

A Vevaty account **is** a verified phone number. Not an email with a phone
attached, not a username. Everything follows from that one sentence:

- Members sign in with a phone number and a password. Nothing else works.
  (The admin panel is the one other sign-in, and it is not a member login:
  email, password and an authenticator code, at `vevaty.com/control-room`,
  which nothing a member can see links to. An admin account also finds an Admin
  row on Profile that opens the same sign-in, or the panel itself on a
  device already signed in to it. Until 10 Sep 2026 the member
  login screen carried a "Sign in as admin instead" link for every visitor
  to see; see "The admin door is not on the member login".)
- Losing access to the number is losing access to the account, and the
  recovery path is a fresh OTP to that same number.
- Two accounts can never share a number, because Supabase's auth identity
  *is* the number.

This was decided on 29 Aug 2026 and email was **explicitly ruled out** as an
identity at the same time. It is worth restating why, because a registration
form with an "Email\*" field is the single most common shape on the internet
and the pull towards it is constant: a Lebanese marketplace seller has a
phone. They may not have an email they check, they will not remember which
of three addresses they used, and an email nobody verifies identifies
nobody. Meanwhile the phone number is already verified — we pay Twilio for
that — already unique, and already the thing a buyer needs.

## So what is the email for, then

A free channel, and nothing else.

It is **optional**, it is **never verified**, and it is **deliberately not
unique**. Nobody signs in with it, no account is blocked for want of one, and
two accounts may carry the same address. That last one is not laziness: a
unique constraint on an unverified field is a gift to anyone who wants to
lock a real address out of signup by claiming it first.

What it buys is a way to reach a seller that does not cost $0.36. SMS to
Lebanon is one of Twilio's most expensive destinations, and WhatsApp — which
would cost about $0.06 — is blocked by Meta (see @LIFECYCLE.md). An email
address costs nothing to send to and is a plausible way back in for someone
who changed numbers. That is the whole case for the field, and it is enough
of one to collect it while somebody is already typing.

The consequence to hold on to: **an unverified email is not evidence of
anything.** It must never be allowed to authenticate, to recover an account
on its own, or to prove two accounts are the same person.

## The WhatsApp number is a different number

Before this, the listing page built its `wa.me` link out of the seller's
account phone — it simply assumed the two were the same. In Lebanon they
routinely are not. That assumption sent buyers to a WhatsApp account
belonging to nobody, or worse, to a stranger who happens to hold that number
there.

So registration asks for it separately, with a "Same as my mobile number"
checkbox for the majority for whom it genuinely is the same. When it is
empty the listing page falls back to the account phone, which is exactly the
old behaviour — nobody is worse off than before, and everyone who fills it in
is better off.

Reading it back is a `SECURITY DEFINER` function, not a column grant. See
@AGENTS.md: on this table a SELECT grant means *everyone* can read the
column on *every* row, which is why `phone` never had one either.

## The consent checkbox is about us, not about buyers

One line on the form, easy to misread, so: **"Vevaty can message me here
about my own listings" governs what Vevaty sends. It has nothing to do with
buyers reaching the seller.** The number is shown as a contact button either
way — that is what the field is for, and what the form says it is for.

It is collected now, months before it can be used, on purpose. Meta still
refuses template creation on the WABA, so the channel sends nothing at all
today. But consent gathered at registration costs one checkbox, and consent
gathered afterwards costs a campaign to re-ask every user who ever signed
up. The cheap moment is now.

Two rules keep the flag honest, and both are easy to get subtly wrong.

**Consent belongs to a number, not to a checkbox.** Editing the WhatsApp
number — on either screen — clears it. Without that, a box ticked for one
number carries over to a different one, and it happens invisibly: the consent
row is hidden while the field is empty, so it disappears ticked and comes back
ticked against whatever was typed in the meantime.

**The number and the flag travel together or not at all.** When there is no
number, the write omits *both* rather than sending `whatsapp_opt_in: false`.
Those look equivalent and are not: `upsert_own_profile` coalesces a null
argument to "leave the column alone" but takes a literal `false` at face
value. Sending false unconditionally from the repair screen would silently
revoke a consent the user had set months earlier from their profile.

## Why the form is not one page

The screenshot this was built from is a conventional one-page signup: seven
fields, then a Sign up button. Vevaty asks for the phone number one step
earlier instead, and the reason is worth keeping.

That first step calls `myazar.is_phone_registered()` and **branches**. A
registered number goes straight to a password field; an unregistered one
gets the form. One entry point serves both sign-up and sign-in, a returning
user is never asked to fill in a form before being told they already exist,
and — the part that actually matters — a returning user spends no OTP at
all. At $0.36 a message that is the difference between a sustainable login
and a bill that scales with how often people come back.

The cost of the choice, stated honestly: the mobile number appears on the
form as a read-only row with a "Change" link rather than an editable field,
because it was entered and checked one step earlier and that check is what
decided this is a signup at all.

## Where the account is actually created

Not on the form. The form collects; **the OTP verification writes.**

`verifyCode()` makes **one** profile write, carrying everything: the verified
phone, the name, the email, the WhatsApp number and its consent flag. One
call rather than two on purpose — it is a single SQL statement, so it lands
whole or not at all, where a follow-up write can fail on its own and leave a
half-built account nobody notices.

Then the password is attached, and past that line **nothing may report
"verification failed"**. The OTP is spent and the session is real by then, so
that message would send the user to buy a second code for a problem that has
nothing to do with the code. Each of the two failures has its own way out:

- **The password did not attach.** Routed to `setNewPassword`, which sets a
  password on *this live session* — no second OTP, which is the whole point
  of sending them there rather than to "forgot password".
- **The profile write failed.** A ref is set, and `afterAuthenticated()`
  reads that ref *before* it reads anything from the database, routing to the
  old `name` step. That step still shows only a name field — it does not ask
  for the email or the WhatsApp number again, because it does not need to:
  they are still in component state, and `finishSignup` re-sends the whole
  set. Confirming the name is the user's part; the rest is repaired behind
  it.

That ref matters more than it looks. The obvious test — read `full_name`
back, and if it is missing, ask again — does not work here: `AppStore` inserts
a bare profile row from its own **cached** name the moment the session fires,
so the read can find a name this signup never typed and wave a half-written
account straight through. We know whether our write failed. We do not need to
ask.

The `name` step is therefore no longer part of the normal path — the form
covers it — but it remains as the repair screen for both failures above, and
it still catches long-standing accounts that predate having a name at all.

## A member is a confirmed phone, and only the server says so

Added 10 Sep 2026 for the tester round (@TESTERS.md), which is what made
the flag matter.

`profiles.is_phone_verified` has always meant "a verified member", but
until then the server barely consulted it: posting, starting a chat and
seeing a seller's number needed only a non-anonymous session, which a
script can get from the auth API without ever meeting a sign-up screen.
They now need a member — restrictive policies on `listings` and
`chat_threads` INSERT, and a check inside `get_seller_phone` /
`get_seller_contact`.

So membership has to be something a client cannot simply claim. An account
can make itself a member in exactly one place: the `upsert_own_profile`
call that flips the flag on. That call needs a non-anonymous session, a
phone the OTP itself confirmed (`auth.users.phone_confirmed_at` — an
email-and-password account used to be a "member" the moment it asked), and,
while sign-up is invite-only, a claimed invite (`VV002 invite_required`
otherwise; admins exempt). The only other writer is an admin letting a
person in from the Tester centre, through a function that logs it. No
client session — an admin's included — can write the flag, tester roles or
suspension directly: `guard_profile_membership_columns_trg` refuses all
three, because `authenticated` holds table-level INSERT/UPDATE there.

Only the call that MAKES a member is checked. An existing member — a
password recovery, the repair step, a phone change — is never asked for an
invite, and never has invite roles copied over an admin's later decision.
That holds only because the flag never comes down again: the function
ignores a `false`, since a member able to lower it could raise it once
more and be treated as joining for the first time.

One bug came out of the rewrite, worth knowing because it was silent:
the flag was written as `coalesce(excluded.is_phone_verified, …)`, and the
VALUES row coalesces a missing argument to false — so any call that left
the argument out would have un-verified a member. Every caller happened to
pass it. It reads the argument now.

When a sign-up is cut off between the OTP and that write, the account
exists but is not a member. Two things put it right: the app retries the
write on the next launch (`AppStore.repairMembership`, which the server
refuses unless the sign-up itself would have been allowed), and an admin
can let the person in by tagging their number in the Tester centre.

## The guest accounts, and the six of them per launch

The admin Users list showed about a hundred members against two real
accounts. Every one of the others was a guest: an anonymous session, no
name, no listing, no chat, no favourite, nothing that could be
administered.

Guests themselves are by design -- `ensureSession` signs everyone in
anonymously so every write has an `auth.uid()` for RLS to check, without a
login screen. What was NOT by design is how many. Six stores call
`ensureSession` the moment the app mounts (AppStore, SettingsStore,
FavoritesStore, SavedSearchesStore, BannerStore, CollectionsStore), all in
the same tick. Each found no session, and each created its own anonymous
account. 413 anonymous users existed against roughly sixty real launches;
327 of them were created within one second of the one before, in bursts of
six, ten, and once thirty. `getSession()` is not a lock, and nothing else
was one either.

The in-flight promise is now shared, so the losers of the race await the
winner's sign-in instead of starting a second one. It is cleared once
settled: after that the persisted session answers, and a sign-in that
FAILED must not be remembered as the answer.

The 413 anonymous accounts and the 96 guest profile rows they left behind
were deleted -- checked first against every table that references a user,
which returned zero rows for all 413. Two accounts remain, which is the
true number.

The admin list defaults to registered accounts now, with the guest count
in plain sight and one tap from showing them, labelled. `is_phone_verified`
is what separates them: `verifyCode` writes it through
`upsertOwnProfile` the instant an OTP is accepted, before anything else in
signup can fail, so it is a fact about the account rather than a guess
from its name or its listing count.

Two things this leaves open. A guest still gets a `profiles` row written
at launch, which is a row per device for people who may never register --
harmless at this size, worth revisiting if guest traffic ever gets real.
And nothing sweeps anonymous accounts on a schedule; the next hundred will
need the same clean-up by hand.
## Editing an account as an admin

Admin -> Users searches by name, phone, email or district and opens one
person on their own screen, where their details, points, tier, listings and
suspension all live together.

Three things about it are not obvious.

**It all goes through SECURITY DEFINER functions, and not because RLS is
missing.** `authenticated` has no column grant on `profiles.phone`, `email`
or `whatsapp` -- deliberately, as above, because that table's SELECT policy
is `true`, so a grant there publishes every user's number to every
signed-in account. An admin screen therefore cannot read those columns at
all, whatever the policies say, and searching by phone number is impossible
from a client. `admin_search_users`, `admin_get_user`, `admin_update_profile`
and `admin_grant_points` are the way in; each checks `myazar.admins` itself
and raises `not_admin` otherwise.

**The phone is not editable, and that is the point.** `profiles.phone` is a
copy of the login identity in `auth.users`. Writing one without the other
gives an account that displays a number it cannot sign in with, so the
function refuses the field outright rather than trusting a screen not to
send it. Moving an account to a new number stays the user's own
OTP-verified action under Change phone.

**A tier can be granted, and it sticks.** `profiles.tier` used to be
recomputed from points by every RPC that touched a balance, so an
admin-set tier silently reverted the next time the seller posted anything.
`profiles.tier_override` now holds the admin's answer, `myazar.effective_tier`
is the only thing that decides what `tier` becomes, and every write of the
column goes through it. NULL means "follow the points", which is how every
account starts and what clearing an override returns them to. Nothing else
in the app learns about the new column -- `profiles.tier` still carries the
effective value everywhere it is read.

Changes are recorded in `myazar.admin_actions` -- who, whom, what changed
and what it was before. Suspension writes there too, through the same
function as everything else, so the most consequential thing an admin can
do to an account is not the one thing missing from the log. The table has a
SELECT policy for admins and no INSERT policy for anyone: an audit trail a
client can write is not an audit trail. Points grants land in
`points_transactions` as well, category `bonus` so they sit outside the
300-a-month earning cap, and the seller reads the reason text on their own
points activity screen -- write it as a sentence they should see.

## The admin door is not on the member login

Removed 10 Sep 2026, at Yousif's request: the login every buyer and seller
sees carried a "Sign in as admin instead" link. It protected nothing — the
panel's safety is the password and the authenticator code, not the link
being hard to find — but it told every visitor there was a door, and put an
email-and-password form one tap from a screen whose whole design says
"your phone number is your account".

What replaced it:

- **`vevaty.com/control-room`** is the admin panel's own sign-in
  (AdminGateScreen), in any browser, desktop or phone. Typed or
  bookmarked; linked from nothing public. It was `/admin` for a few hours
  on 10 Sep; Yousif moved it because `/admin` is the first address anyone
  tries — people and the programs that sweep sites for admin pages alike.
  `control-room` is not a standard admin address (as `/dashboard` and
  `/management`, the other two he considered, both are), so those programs
  are unlikely to try it. It is obscurity and not a lock: the address sits
  in the site's own code, which every visitor downloads. The old address
  now just opens the site's start.
- **Every inner admin page shows that sign-in to anyone not signed in to
  the panel** (`adminOnly`, wrapped around each one in RootNavigator).
  Before this, the inner pages were plain routes: typing
  `vevaty.com/admin/branding` gave anyone the whole branding editor, and
  `/admin/users` the user search. Nothing would have saved — the server
  checks `myazar.admins` on every write — but "invisible to members" has to
  include the pages behind the front door.
- **Profile shows an Admin row to an admin account and to nobody else** —
  `testerStatus.isAdmin` from `my_tester_status()`, so the row is there
  before the admin has signed in to the panel, in the app and on the
  website alike. It opens the same sign-in: email, password, code (or the
  panel itself, on a device already signed in to it).
- **Being signed in with the phone does not shorten that.** A first draft
  let an admin already signed in with their phone through on the
  authenticator code alone. It came out before it shipped: on a phone the
  authenticator usually lives on the same device, so every unlocked phone
  the admin is signed in on would have been the whole admin login — and
  the privacy policy tells users a regular session never reaches
  administrator functions. The same is still true of a device that HAS
  been through the panel's sign-in: it stays signed in to the panel,
  across relaunches, until "Sign out of admin", and the lock asks only for
  the code. So a phone should sign out of admin when done — which, since
  the same change, signs out that device only. On a phone that also leaves
  no member signed in, since the panel's sign-in replaced the phone
  session: sign back in with the number. To end every session at once — a
  laptop left signed in to the panel, say — the member Log out still
  signs out everywhere.
- **The first-admin "set up" form is gone from that page.** Its database
  half — the policy that let the first account claim the admins table —
  was closed the same day (see @AGENTS.md, "A policy's subquery sees only
  what the caller can see"), so all it could still do was create a stray
  email account and then fail. An admin is added from the database now,
  and the account needs an email and a password to sign in at all.

Hiding the door is not the lock. The server still checks
`myazar.admins` and not the session's authenticator level (see @NEXT.md),
so the password alone is what an attacker would need, whichever screen
they did or did not find.

## What is deliberately still missing

- **Nothing verifies the email.** By design, per the above. If that ever
  changes it becomes a second gate at signup and roughly doubles the
  drop-off, so it should be a decision, not a tidy-up.
- **No CAPTCHA.** The password sign-in has a five-attempt client-side
  cooldown, which is a speed bump against someone mashing a button and no
  defence at all against a script hitting the API directly. Real protection
  is Supabase's own CAPTCHA integration, still not wired up.
- **Leaked Password Protection is still off** in the Supabase dashboard.
  It was recommended when regular users first got passwords and has not been
  enabled.


## Buyers rating sellers

A buyer who has **contacted** a seller about a listing can rate them one to
five stars, with an optional comment. One review per buyer per listing,
editable afterwards.

**The gate is contact, not a sale, and that is a correction.** The `reviews`
table was keyed to `transaction_id` — and transactions are payment records,
which do not exist and will not until there is a payment provider. So the
review system was not half-built, it was built on a gate nobody could ever
pass: a unique constraint over a column that is always null constrains
nothing, and no row could be inserted honestly. What is available instead is
proof of contact, and the app already records it — `get_seller_phone` writes
a `listing_contact_events` row for exactly this purpose, and a chat thread on
the listing is the other half. `transaction_id` survives, nullable, so a
future settled sale can point at its review without a second migration.

A review is per LISTING rather than per seller: it is about one interaction
over one item, which is what a reader wants to weigh, and it is what makes
"one each" enforceable (`reviews_one_per_listing`).

**Everything is written through `myazar.leave_review`.** The old
"reviewer can create a review" policy was dropped and INSERT/UPDATE/DELETE
revoked from `authenticated`, because that policy could only test
`reviewer_id = auth.uid()` — which a buyer who had never spoken to the
seller satisfies perfectly. The gate reads `listing_contact_events` and
`chat_threads`, neither of which a buyer may select for themselves, so the
check has to be SECURITY DEFINER on the server rather than a policy the
client could satisfy by asserting something about itself.
`myazar.can_review_listing` returns the same decision as a reason code so a
screen can offer the button only when it will work, rather than offering it
and then refusing.

**The score is denormalised onto `profiles`.** `rating_avg` and
`rating_count`, maintained by a trigger on `reviews`, granted SELECT to
everyone — the whole point of a rating is that a stranger sees it before
making contact. They are two columns rather than an aggregate because every
card, seller page and listing wants them and none of those can aggregate
over a PostgREST call.

**A fabricated rating was removed at the same time.** `listing.rating` is
hardcoded to `5` everywhere a listing is constructed, so every seller in the
app displayed "5.0" having never been rated once. On a product whose pitch
against the incumbent is that its trust signals mean something, an invented
five stars is worse than no stars. The listing page now shows the real
average and shows nothing at all until somebody has actually left a review.

`POINTS_RULES.leaveReview` (20) is wired for the first time, on a new review
only — editing one is not a second contribution — and inside the same
rolling 300/30-day cap every other recurring award respects, so reviewing
thirty listings cannot mint a tier.
