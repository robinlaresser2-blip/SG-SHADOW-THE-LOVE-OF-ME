# Mod security implementation and activation

These changes target ClientLoader0792, the custom .NET 6 MelonLoader, and backend-purchase-fix/StumbleUltimate-backend-main. They have not been installed into the game or deployed to Render. The original ranked-rewards issue remains separate and unresolved.

| Requested protection | Current implementation and limits |
| --- | --- |
| Code obfuscation | Obfuscar 2.2.50 selectively renames the new session helper. Other mod types are preserved; this is not whole-mod obfuscation. |
| Assembly integrity | Existing AES-GCM plus signed package and binary SHA-256 verification. |
| Signed manifests | RSA-PSS/SHA-256, minimum 3072-bit publisher key, signed build ID, file list, and expiry. |
| Loader verification | Checks loader, NativeHost, and version.dll against the signed manifest before protected package loading. Requires a publisher key embedded at build time. |
| Server-side licensing | Optional administrator-owned Users.modLicense grants. No client endpoint can grant licenses. Provisioning is pending the owner's eligibility decision. |
| Short-lived auth tokens | Five-minute mod access JWTs, client renewal at four minutes, explicit issuer/audience/algorithm validation. Existing game login credentials are still longer lived. |
| Device/session binding | Server checks device ID and active game token; mod tokens bind their hashes, account and build. Device IDs can be spoofed; this is not hardware attestation or device-key possession proof. |
| Secure updater | HTTPS-only, no redirects, bounded/time-limited downloads, signed manifest and per-file validation into a new staging directory. No automatic installation, rollback transaction or local anti-downgrade store yet. |
| Secret separation | New JWT key stays in server environment; publisher private key stays outside release directory. No new shared signing secrets in client. Legacy embedded protocol strings still exist and are not a security boundary; migration/rotation remains necessary. |
| Native sensitive code | Uses platform cryptography via standard .NET APIs. No new native security DLL was added; licensing decisions remain server-side. |
| Anti-tamper | Signed files and authenticated packages checked at protected load. No promise of detecting all in-memory changes or a replaced verifier. |
| Debug/release hardening | Release mod builds optimized, deterministic, without generated debug symbols. Secure loader build rejects missing publisher key or Debug configuration. Old PDBs may remain locally but are not in the preview artifact. |
| Replay protection | Optional per-request HMAC and 60-second timestamp window; atomic MongoDB unique nonce insert, shared across instances, TTL cleanup. Binds path/query and body bytes, not HTTP method; use distinct paths for semantically different methods. Native serialization and retries need in-game validation. |
| Rate limiting | 600 authenticated requests/account/minute on routes after the main auth middleware; bounded per-process storage and Retry-After. Not distributed ingress protection; earlier routes and unauthenticated login need separate controls. |
| Revocation | Active token rotation rejects old game/mod sessions. Revoked/expired license grants are checked on each protected request when enforcement is on. |
| Build fingerprinting | Signed package digest identifies exact release bytes. Auth header also carries public compatibility ID ultimate-0792-security-1; this self-reported ID is not remote attestation. |
| Feature authorization | Server route policy for core, ranked, abilities. Client-only/offline functions are not a server authorization boundary. |
| Version enforcement | Optional server build allowlist plus signed manifest expiry. Enable only after updated clients are available. |
| Config integrity | Signed release policy plus optional MOD_SHARED_SHA256 check of shared.json at backend startup. Does not verify live configuration changes after startup. |
| Abuse telemetry | Local, aggregate denial counters once per minute and rate-limit events, without credentials/device IDs/bodies. No external telemetry service or automated banning. |

## Validation performed

ClientLoader Release compilation succeeded with 40 existing warnings. The .NET 6 win-x64 loader compiled with three warnings. ReleaseSigner compiled without warnings. Obfuscar completed and unselected top-level type names were checked against the original assembly. 55 .NET checks covered package tampering, wrong keys, expired manifests, unsafe paths and valid/tampered/HTTP update staging. The backend's 12 test cases passed, including session expiry/rotation, device and feature policy, request proofs and existing purchase tests.

Still required before enforcement: actual game login, five-minute renewal, native request byte compatibility, Mongo nonce concurrency/TTL integration, multiple-device rejection and full game smoke tests. Signed-update tests use an in-memory HTTP transport, not a production update host.

## Backend activation

Deploy the updated backend modules together. Existing token/device checks are enabled immediately in code and now fail closed; malformed auth cannot fall through. The following stricter controls are opt-in to avoid locking out current clients before migration:

```
MOD_LICENSE_REQUIRED=1
MOD_ALLOWED_BUILDS=ultimate-0792-security-1
MOD_SESSION_REQUIRED=1
MOD_REQUEST_PROOF_REQUIRED=1
```

Set MOD_SESSION_SIGNING_KEY to a separately generated high-entropy secret of at least 48 bytes, stored only in the hosting service secret settings. Never reuse Salt, a payload key, or a client constant. Optional MOD_SHARED_SHA256 is the SHA-256 hex digest of the reviewed shared.json deployed with the backend. Invalid security switches fail startup.

Before enabling licensing, provision each authorized user's existing MongoDB document with an administrator-owned modLicense object:

```
{
  enabled: true,
  revoked: false,
  expiresAtMs: <future UTC Unix time in milliseconds>,
  deviceId: <that account's existing deviceId>,
  features: ["core", "ranked", "abilities"]
}
```

No grants or signing secrets have been created automatically. Revocation sets revoked=true or enabled=false. Restrict build IDs to approved versions. A revoked account cannot renew a mod session when license enforcement is enabled. Keep the MongoDB nonce collection's unique _id index and TTL index. Do not enable proof enforcement until byte-for-byte request compatibility has been confirmed in game.

## Signed release build

Keep an RSA publisher private PEM key outside all game and staging directories; store it in an offline signing environment or protected CI secret store. Embed only its exported public PEM key into the loader. For example, from the workspace root:

```
dotnet build MelonLoader/MelonLoader/MelonLoader.csproj -c Release -f net6 -p:Platform=x64 -r win-x64 -p:SolutionDir=C:/Users/mykyt/Desktop/CM/MelonLoader/ -p:RequireSignedRelease=true -p:ReleasePublicKey=C:/secure/publisher-public.pem
dotnet build ClientLoader0792/UltimateMod.csproj -c Release
```

Run the pinned Obfuscar tool from ClientLoader0792 with obfuscar.xml. Pack bin/Protected/ClientLoader.dll with ModPacker using the existing payload key. Stage ServerLoader.bin, ServerLoader.sha, version.dll, MelonLoader/net6/MelonLoader.dll and MelonLoader/net6/MelonLoader.NativeHost.dll. Sign only after all binaries are final:

```
dotnet run --project ReleaseSigner -c Release -- <stage-directory> <private-key.pem> <build-id> <expiry-UTC>
```

The signed loader rejects missing, invalid or expired manifests; it cannot fall back to an unsigned protected package. The normal developer loader remains compatible with the old package format when built without a publisher key. This distinction matters: the preview is not an activated signed production release.

Update staging:

```
dotnet run --project ReleaseSigner -c Release -- stage <HTTPS-release-base-URL> <trusted-public-key.pem> <new-stage-directory>
```

Obtain the public key through the trusted release process, not from the same untrusted update response. A missing ServerLoader.manifest.json in the staging directory indicates an incomplete download. Do not install such a directory. Installation and rollback remain manual, with the game closed and existing files backed up. The updater does not distribute payload decryption keys.

Obfuscation follows the upstream [marked-only configuration](https://github.com/obfuscar/docs/blob/master/getting-started/configuration.rst) and uses the pinned [Obfuscar 2.2.50 package](https://packages.nuget.org/packages/Obfuscar.GlobalTool/2.2.50). Extending renaming to Harmony patches, Unity lifecycle methods or IL2CPP types requires additional compatibility testing.
