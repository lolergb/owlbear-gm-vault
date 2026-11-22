# Named private backup UI

This records the named private backup dialog added for PR #26 / v2.2.0: save multiple named copies and choose a saved copy for restoration. It is an **Operate** extension of the existing Settings and modal interface. Its hierarchy, forms, buttons, typography, and Owlbear theme remain inherited; this document does not establish a new application identity.

## Source of truth

- [CloudBackupDialog.js](../js/ui/CloudBackupDialog.js): native dialog, fields, actions, focus, validation, and loading/error presentation.
- [ModalShell.js](../js/ui/ModalShell.js) supplies the labelled panel used by the vault's dialogs.
- [CloudBackupFlow.js](../js/services/CloudBackupFlow.js): account, naming, selection, review, confirmation, and result states.
- [ModalSelect.js](../js/ui/ModalSelect.js) and [modal-select.css](../css/modal-select.css) provide the same searchable picker used for folders and pages.
- [cloudBackup.js](../js/utils/cloudBackup.js): backup-name validation and user-facing error messages.
- [app.css](../css/app.css), [ui-typography.css](../css/ui-typography.css), and [button-tokens.css](../css/button-tokens.css): incumbent modal, input, label, type, button, spacing, and shape rules.
- [themeManager.js](../js/utils/themeManager.js): Owlbear theme values mapped to shared CSS custom properties.

Implementation files remain authoritative if this snapshot becomes stale.

## Components and states

The surface uses one native modal `dialog`, labelled by its `h2`, with plain explanatory paragraphs and a form. Primary actions use the application's primary button; Cancel uses the secondary button. Account management appears beside the signed-in identity. Other supporting actions use text buttons above the footer. Errors are inline `role="alert"` messages. Loading uses a `role="status"` paragraph and a visible dismissal action.

| State | Information and action |
| --- | --- |
| Sign in | Required Email field; Send code. The local vault remains usable without signing in. |
| Verify | Required One-time code field with numeric input mode and a 6–10 digit pattern; Verify code, Change email, or Resend code. Resend displays a countdown and is disabled during its cooldown. |
| Name a copy | Account, local page/folder counts and size, required Backup name, existing-name suggestions, and Review backup. |
| Select a copy | Account, required Saved backup selector, and Review backup. Each option shows its name and localized saved date/time. |
| Empty account | “No private backups found”; account change or Done. |
| Review | Account, full backup name, remote summary/date when present, local summary, consequences, applicable warnings, back action, and explicit confirmation. |
| Loading | Connecting, sending/verifying codes, checking copies, reading the chosen payload, saving, or restoring. |
| Result/recovery | Saved/restored confirmation; retry of a failed room update; uncertain-save checking; or an error with recovery instructions. |

## Field semantics and replacement review

Backup name starts with a localized timestamp and accepts free text. When copies exist, the arrow at the end of the field opens the shared picker. Choosing a name fills the editable field. The field has an HTML maximum length of 80. The domain validator trims and normalizes to NFC, requires 1–80 Unicode code points, and rejects control characters. A new name creates a separate copy. An existing matching name requires reading that copy and reviewing its current contents before replacement.

Saved backup uses the shared modal picker backed by a required select. Its initial prompt is “Choose a backup…”. Review becomes available after a saved-copy ID is selected. Results show each name above its localized saved date and time. Search, arrows and Enter select a result. Escape dismisses the picker and returns focus to its trigger.

Review names the destination and consequence before a write. Saving uses “Save private backup” for a new name or “Replace private backup” for an existing name, and explains that other saved copies are kept. “Change name” returns to naming. Restoration uses “Restore private backup”, explains replacement of the local vault in the current room, retains the previous local copy for Undo restore, and explains player-access and Notion-token handling. “Choose another backup” returns to selection. Selecting or reviewing a copy does not itself confirm replacement.

## Keyboard, focus, and asynchronous work

The native modal supplies focus containment. Escape and Cancel close it, resolve a pending choice with `null`, remove the dialog, and return focus to the element active before opening. The required field receives initial focus when present. Enter submits the form's primary action through native validity checks. Action buttons are disabled after a choice to prevent duplicate submissions while the next step starts.

A short review initially focuses its primary action. A review taller than the dialog initially focuses the heading with `tabindex="-1"`; this heading is outside the normal Tab order. Focus uses `preventScroll`, and each choice resets dialog scroll to the top so a long name and summary are read before confirmation. Users can scroll down and Tab to the actions.

Both reads of a chosen payload—an existing name being replaced and a restore selection—first show “Loading your private backup” with Cancel. Closing while that read is pending prevents the later review or commit. Loading during a committing step instead offers Close and states that the operation may finish after dismissal; dismissal is not a promise to abort an operation already sent. Before committing, the flow rechecks the account, room, and local-vault context.

## Theme and width inheritance

The dialog uses the shared modal surface, title, descriptions, metadata, fields and action group from the application stylesheet. It follows the Owlbear theme. At widths above 480px, Cancel and the primary action share the footer. At narrower widths they stack with the primary action first in both visual and keyboard order.

## Verification record and limits

### Checking private backup events in Mixpanel

Filter the **Events** view to `private_backup_flow`, `environment = beta`, `deploy_context = deploy-preview` and `app_version = 2.2.0`. To isolate one revision, add its full Git SHA as `build_ref`. Events begin with this instrumentation and require analytics consent.

| Question | Mixpanel setup |
| --- | --- |
| Where did GMs cancel? | In Insights, select Total Events, filter `outcome = cancelled` and break down by `operation` (save or restore) and `step`. |
| What went wrong? | Filter `outcome = failed` and break down by `step` and `error_code`. A recoverable error has `terminal = false` and can be followed by success in the same attempt. |
| What happened after a retry? | Inspect the same `attempt_id` in Events, using `sequence` for ordering. Filter `terminal = true` to count final results. Use total events for attempt counts. |

To verify before inviting testers, open **Settings → Restore private backup** in a test room. With a signed-in test account containing a copy, cancel at the chooser. Expect `operation = restore`, `step = select`, `outcome = cancelled`. With a signed-out account, cancelling at the email prompt gives `step = email`. For an error check, use **Save private backup** in a separate, empty test vault. Expect `operation = save`, `step = prepare`, `outcome = failed` and `error_code = empty`.

The flow starts at `open` and then prepares the vault, connects, and checks the session. Signed-out users go through `email`, `send_code`, `enter_code`, and `verify_code`. The next steps list the copies, collect a `name` or a `select` choice, read existing data when needed, and show `review`. Confirmation goes through `authorize`, then `save` or `restore_local` and `sync_room`.

A dismissed dialog counts as cancelled only while the operation can still be stopped. After a write is dispatched, its actual result determines the outcome. A locally restored vault whose room update failed can end as `local_only`. Finding no copies and confirming an earlier pending save have their own outcomes, `no_backups` and `previous_save_confirmed`. A closed browser or lost connection can leave a started attempt without a terminal event.

Each attempt receives a new random ID. These events use a temporary analytics identity and exclude Owlbear and Supabase account IDs, room and backup IDs, email, OTP, backup names, URLs, payloads and raw error messages.

### Previous release checks

The shared picker was exercised with two named copies in the local browser fixture, at 600×700 in dark mode and 360×640 in light mode. The checks covered name entry, choosing an existing name, search, keyboard selection, cancel, and the review of the selected copy.

The primary implementation session inspected the selector in dark and light themes and a long name at a 360×640 viewport, including recovery from a name exceeding the 80-character limit. The long review started at its heading with no horizontal overflow. No screenshot files were available for this documentation pass. This records that inspection, not an independent visual audit or measured contrast certification.

The reviewer disposition was **ship** for the source/semantic fix: both chosen-payload reads expose cancellable loading, and delayed-read tests for save and restore passed. The primary session also reported 59 database checks passing. These results are supplied verification evidence; this documentation pass inspected the source and did not rerun those checks.

The hosted named-copy migration was applied after this documentation pass; a read-only check confirmed the previous payload, date and revision were preserved, RLS enabled and three policies active. The primary session then tested the deployed `abf06bc` preview with the real Supabase service: two named copies with 12 and 13 pages were saved and independently restored in a second Owlbear room. A distinguishing page appeared only when restoring the second copy. Replacing that name increased only its revision; the first named copy and migrated `Previous backup` remained intact. Anonymous Data API access was rejected with HTTP 401. The final local suite passed 865 tests across 79 suites and 59 database checks. Hosted tests used one account and two rooms in the same browser; another device and a second hosted account remain recommended follow-up QA.
