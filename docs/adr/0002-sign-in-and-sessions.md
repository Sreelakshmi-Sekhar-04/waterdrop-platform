# ADR 0002: Sign-in, sessions and people records

**Status:** Accepted (Phase 3, 19 Nov 2026). Follows approved decisions D-01, D-02, D-15, D-17 and the Phase 0 analysis §12.

## Decision

### One way in: an SMS code

- Every sign-in starts with a 6-digit SMS code (`randomInt`). Only an HMAC of the code is stored. A code lasts 5 minutes
  and allows 5 tries. The try is counted in the database before the code is compared, so parallel guesses cannot get
  extra tries.
- Limits: a new code after 30 seconds, at most 3 codes per number in 10 minutes and 10 per day, and a per-IP hourly
  limit (`OTP_PER_IP_PER_HOUR`, default 30).
- Asking for a code gives the same answer whether or not the number has an account, so the API cannot be used to find
  out who is a customer or staff member.
- If the SMS provider fails, the code is cancelled and the app says "We could not send the SMS" (`OTP_SEND_FAILED`).

### Per app

| App | First time | Every day | Session |
| --- | --- | --- | --- |
| Customer | SMS code creates the account, then name, language and privacy notice, then the first address | SMS code (session lasts 90 days and renews with use) | 90 days, sliding |
| Delivery staff | SMS code on this phone, then choose a 4-digit PIN (common PINs refused) | PIN on the same phone | 16 hours, fixed |
| Office (admin, owner) | SMS code, then create a password (10+ characters) | SMS code **and** password | 12 hours, fixed |

- Staff PINs and office passwords are hashed with argon2id. 5 wrong PINs switch the PIN off on that phone, and the
  person signs in with an SMS code again. A wrong office password counts as a wrong code, and every office failure
  gives the same message, so it does not reveal which part was wrong.
- Changing the office password signs out the person's other browsers.

### Sessions

- Access token: 15 minutes, in memory only. Refresh token: random, stored as a SHA-256 hash, replaced on every use.
  Using an old refresh token again ends the whole session family (theft detection).
- Mobile keeps the refresh token in the phone's secure storage. The office portal keeps it in an httpOnly,
  SameSite=Strict cookie limited to `/api/v1/auth`; office requests must also send `X-WtrDrop-Client: admin`.
- The server checks on every request that the session is still open, so switching someone off signs them out at
  once, not after 15 minutes.

### People records

- `customers` (one per customer user per supplier), `addresses` (up to 10, exactly one default, removed addresses are
  archived), `service_areas` (name, Malayalam name, PIN codes), `staff_devices` (one active PIN per phone).
- An address is accepted only if its PIN code is in an active delivery area. A PIN code can be in only one active area.
- `user_roles.status` switches a person off without deleting their history.
- Every office change to customers, staff, office accounts and areas is written to the audit log.

### SMS providers

- `dev-outbox` (development and tests only): codes are written to a local file with owner-only permissions. The API
  refuses to start with it when `NODE_ENV=production`.
- `msg91` (production): MSG91 Flow API with a DLT-approved template. **Not yet tried against a real MSG91 account**;
  it needs the business's MSG91 account and DLT registration. Start-up fails if its keys are missing.

## Consequences

- No fake or test login exists in any build. Browser tests sign in for real against a throwaway database, reading
  codes from the dev outbox.
- Real SMS cannot go live until DLT registration (2 to 4 weeks) is complete.
- In development builds only, `EXPO_PUBLIC_PREVIEW=1` lets the later-phase demo screens open without an account; they
  carry a demo-data banner.
