# Required Discord login

This change is staged until the owner creates a Discord application. No bot is required.
It uses Discord's authorization-code flow and the `identify` scope only:
https://discord.com/developers/docs/topics/oauth2

## Setup and rollout

1. Create **Stumble Ultimate** at https://discord.com/developers/applications.
2. Under OAuth2, register exactly:
   `https://stumbleultimatedontskid.onrender.com/auth/discord/callback`
3. Set these variables privately in Render:
   - `DISCORD_CLIENT_ID`: application ID.
   - `DISCORD_CLIENT_SECRET`: OAuth2 client secret (not a bot token).
   - `DISCORD_REDIRECT_URI`: the redirect URL above.
4. Deploy the backend with `DISCORD_LOGIN_REQUIRED=0`, then install the matching client build.
5. Set `DISCORD_LOGIN_REQUIRED=1` and redeploy. Missing/invalid configuration stops startup.
6. Restart the game, press **Sign in with Discord**, approve in the browser, and return to the game.

The public `/auth/discord/config` endpoint reports whether login is required, never credentials.
Do not ship the Client Secret in the mod or commit it to the repository.

## Account ownership

Discord identity selects the account, rather than a supplied player ID. An existing device account
can be linked only with its valid game session token. The client supplies `User.Me.Token` if
available. If the game has not loaded that token at startup, linking returns HTTP 409; the
owner must arrange verified account migration before enabling required login for that player.
There is no automatic link based only on device or player ID, and no silent reset of progress.
A Discord identity has at most one game account, enforced by a MongoDB unique index.
Logging in on another device rotates the game session and updates its device binding.

Browser sessions expire after five minutes. OAuth state is bound to a Secure, HttpOnly,
SameSite=Lax cookie. Game polling uses a separate secret. Login proofs are consumed atomically
once. Discord access tokens are used only server-side to fetch identity and are not persisted.
The flow does not store refresh tokens: each game login requires browser authorization.

## Validation and limits

`node --test DiscordLogin.test.js` exercises browser binding, wrong polling secrets, pending
claims, callback replay, single-use login proofs and expiration with mocked Discord responses.
The client compiles against the existing IL2CPP wrappers. A real Discord application and an
in-game test are still required to verify browser authorization, native login timing and migration.
The sign-in panel includes retry on cancellation/expiry; it does not close the game.
