# Beta vault recovery — 2.1.2 candidate

Status: implemented locally; publication to the beta alias and production is still required.

## User behavior

When the active GM opens a room in production, recovery checks that room's beta storage before loading or broadcasting the vault. It copies only into a destination with **no saved room vault and no legacy default vault**. An intentionally saved empty vault counts as existing data.

Identical JSON needs no replacement. Different vaults show **Keep current vault**, **Use beta vault**, or **Decide later**. Replacement first saves and reads back the exact current JSON as a local backup. Settings exposes **Download vault before beta recovery**; that JSON can be restored using the existing **Import from file** flow. The original beta bytes are never edited or deleted. **Clear Local Data** also removes these production backups, while retaining the non-content recovery decision so data does not automatically reappear.

A missing Notion token is copied only when accepting the beta vault or when the vaults are identical. An existing production token is never overwritten. Token write failure leaves recovery retryable and gives a separate message. No vault content or token travels through analytics, URLs, room metadata, logs, or room broadcasts during recovery. The normal GM-connected sharing workflow continues afterward.

After a completed import or a Keep decision, automatic recovery stops for that room. **Recover beta vault** in Settings explicitly retries. This is a one-time copy, not ongoing synchronization: later beta edits require an explicit retry.

## Browser limitations

The data lives in the user's browser, profile and storage partition. The bridge cannot recover another device/profile, deleted storage, or storage blocked by browser privacy restrictions. There is no server-side vault to retrieve.

The automatic bridge has a three-second timeout. Unavailable/missing beta storage does not stop the production vault loading and does not mark recovery complete. Settings explains how to retry or use **Backup GM Vault** in beta followed by **Import from file** in production. There is no popup workaround or request to disable browser protections.

## Fixed origins and deployment order

- Source: `https://deploy-preview-10--owlbear-gm-vault.netlify.app` — confirmed by the published Quick Start Beta guide.
- Destination: `https://owlbear-gm-vault.netlify.app`.
- Source endpoint: `/html/beta-migration-bridge.html`.

The original preview alias is essential. A new PR preview or the develop branch domain has different localStorage and cannot replace it.

1. Publish the source endpoint, its entry module, `BetaMigrationBridge.js` and `betaMigration.js`, plus its headers **on the existing preview-10 alias**, preserving the beta app and functions. Do not deploy just four files as the whole site: Netlify deploys replace the site's file set.
2. Verify that the exact alias serves the bridge and modules, with `no-store`, `no-referrer` and the intended CSP. A 200 response serving the app's index fallback is not sufficient.
3. Prepare the production 2.1.2 deploy. Test with a synthetic Owlbear room using the same browser/profile: beta→production without a destination vault, conflict choices, preserved source, and GM-connected sharing. Do not enable recovery against a new preview alias to simulate the source.
4. Publish production only after the source alias is ready. Production currently has manual publication/locking; pushing a commit alone is not evidence that users received it.

Netlify documents custom draft aliases using `netlify deploy --alias=...`. Whether assigning `deploy-preview-10` supersedes this existing PR alias must be verified on the account before relying on it. There is no confirmed rollout to this alias in this change. A redirect to another origin will **not** recover the original storage.

References:

- [Netlify draft deploy aliases](https://docs.netlify.com/api-and-cli-guides/cli-guides/get-started-with-cli/#draft-deploys)
- [postMessage security requirements](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage#security_concerns)
- [Browser storage partitioning](https://privacysandbox.google.com/cookies/storage-partitioning)

## Implementation and validation

The source responds only to its direct parent at the exact production origin, with a validated room ID and 128-bit request nonce. The receiver checks exact origin, source window, protocol, room, nonce and bounded payload. The bridge's CSP permits the production frame and Owlbear ancestors, has no network connection permission, and loads only same-origin scripts.

The controller verifies the SDK role, room, player/connection and active room owner before reading and immediately before committing. Players, Co-GMs, default/unknown rooms, modal viewers and failed SDK checks cannot start recovery. The engine validates the beta configuration, preserves raw JSON bytes and unknown fields, compares the destination again after a choice, and verifies every vault/backup write before marking completion. Browser Web Locks serialize cooperating recovery commits where supported. Other tabs editing the vault use the existing application storage semantics; this feature does not introduce general cross-tab editing synchronization.

Automated coverage includes forged messages, timeouts, cleanup, role/room changes, destination changes, corrupt JSON, quota/readback failures, existing empty vaults, legacy defaults, token preservation, retry and startup ordering. The full suite also covers v1 compatibility and GM/player sharing.

Validation result: **713 tests passed in 62 suites**, including 49 new recovery tests. Release/version assertions now compare the entry points and manifest with the package version, rather than stale 2.1.0 build numbers.

Browser QA used the actual bridge, recovery engine and dialog with synthetic data and three local origins: an outer app, production and beta. The beta fixture was first opened directly under the outer app, then read from a nested production iframe. Verified exact raw copy, missing token copy, existing token preservation, Keep, replacement backup, idempotent retry and untouched beta original. The dialog was checked at 360px panel width. This is local browser evidence, not a claim of cross-browser validation in the deployed Owlbear extension.
