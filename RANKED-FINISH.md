Ranked finish v4

POST /ranked/game/finish now credits the active season's configured RP bands and fixed XP/pass-token rewards. The current season awards a first-place finish 1,000 XP and 1,000 pass tokens. RP depends on rank and placement. Both profile and top-level balances are synchronized.

MongoDB must support transactions (replica set or sharded cluster). Account changes and a permanent RankedGameReceipts record are committed together. The receipt's primary key binds the account and game ID; retries return the original reward result without paying again. Do not delete receipts while old results may be replayed. Failed persistence returns 503 rather than claiming success. Transaction work has a 15-second timeout.

This private-server path accepts authenticated client-reported placements. It does not verify SignedPayload against a match server, and does not stop a modified client fabricating new game IDs. Season/friend boosts and tier reward ceremonies are not implemented. Other season reward types require explicit support; unknown types fail rather than silently disappearing.

Validation: node --test *.test.js (19 tests passed). Transaction rollback/retry tests use an in-memory adapter; a live MongoDB and game reward-screen check remain required.

After deployment, /health/diagnostics reports rankedDiagnostics v4 and rankedScoring true. A saved finish logs [RankedFinish v4] committed with RP, XP and pass-token amounts. The UpdatedUser response contains persisted balances; no client-only reward counter is faked.
