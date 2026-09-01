# What a Vevaty account is, and why

Written 1 Sep 2026, when registration became a real form instead of a
password box. The mechanics live in `AuthScreen.tsx`; this is the record of
why they are what they are, so that the next person to open that screen does
not undo a decision by accident.

## The phone number is the account

A Vevaty account **is** a verified phone number. Not an email with a phone
attached, not a username. Everything follows from that one sentence:

- Members sign in with a phone number and a password. Nothing else works.
  (The one exception is not a member account: the same screen carries a
  "Sign in as admin instead" link, which is email + password + TOTP.)
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
