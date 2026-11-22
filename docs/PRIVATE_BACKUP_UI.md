# Named private backup UI

This records the named private backup dialog added for PR #26 / v2.2.0: save multiple named copies and choose a saved copy for restoration. It is an **Operate** extension of the existing Settings and modal interface. Its hierarchy, forms, buttons, typography, and Owlbear theme remain inherited; this document does not establish a new application identity.

## Source of truth

- [CloudBackupDialog.js](../js/ui/CloudBackupDialog.js): native dialog, fields, actions, focus, validation, and loading/error presentation.
- [CloudBackupFlow.js](../js/services/CloudBackupFlow.js): account, naming, selection, review, confirmation, and result states.
- [cloud-backup.css](../css/cloud-backup.css): dialog dimensions, wrapping, local focus treatment, and narrow-width actions.
- [cloudBackup.js](../js/utils/cloudBackup.js): backup-name validation and user-facing error messages.
- [app.css](../css/app.css), [ui-typography.css](../css/ui-typography.css), and [button-tokens.css](../css/button-tokens.css): incumbent modal, input, label, type, button, spacing, and shape rules.
- [themeManager.js](../js/utils/themeManager.js): Owlbear theme values mapped to shared CSS custom properties.

Implementation files remain authoritative if this snapshot becomes stale.

## Components and states

The surface uses one native modal `dialog`, labelled by its `h2`, with plain explanatory paragraphs and a form. Primary actions use the application's primary button; Cancel, account changes, and navigation use its secondary/ghost button alias. Errors are inline `role="alert"` messages. Loading uses a `role="status"` paragraph and a visible dismissal action.

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

Backup name is text, not a selector. The initial suggestion is a localized timestamp name; a datalist offers existing names. The field has an HTML maximum length of 80. The domain validator trims and normalizes to NFC, requires 1–80 Unicode code points, and rejects control characters. A new name creates a separate copy. An existing matching name requires reading that copy and reviewing its current contents before replacement.

Saved backup is a native, required `select`. Its initial empty option says “Choose a backup…”; the user must choose an actual saved-copy ID before the primary review action succeeds. Name plus `updated_at` rendered with `toLocaleString()` identifies each option. A long option may be visually truncated by the native control; the following review prints the full name in wrapping text.

Review names the destination and consequence before a write. Saving uses “Save private backup” for a new name or “Replace private backup” for an existing name, and explains that other saved copies are kept. “Change name” returns to naming. Restoration uses “Restore private backup”, explains replacement of the local vault in the current room, retains the previous local copy for Undo restore, and explains player-access and Notion-token handling. “Choose another backup” returns to selection. Selecting or reviewing a copy does not itself confirm replacement.

## Keyboard, focus, and asynchronous work

The native modal supplies focus containment. Escape and Cancel close it, resolve a pending choice with `null`, remove the dialog, and return focus to the element active before opening. The required field receives initial focus when present. Enter submits the form's primary action through native validity checks. Action buttons are disabled after a choice to prevent duplicate submissions while the next step starts.

A short review initially focuses its primary action. A review taller than the dialog initially focuses the heading with `tabindex="-1"`; this heading is outside the normal Tab order. Focus uses `preventScroll`, and each choice resets dialog scroll to the top so a long name and summary are read before confirmation. Users can scroll down and Tab to the actions.

Both reads of a chosen payload—an existing name being replaced and a restore selection—first show “Loading your private backup” with Cancel. Closing while that read is pending prevents the later review or commit. Loading during a committing step instead offers Close and states that the operation may finish after dismissal; dismissal is not a promise to abort an operation already sent. Before committing, the flow rechecks the account, room, and local-vault context.

## Theme and width inheritance

The modal retains the existing surface padding, corner radius, shadow, tint, and UI typography. Text and surface colors use `--color-text-primary` and `--color-bg-surface`; the backdrop uses `--color-bg-overlay`. Native options receive the same text/surface tokens. Error text uses `--color-error-text`; focus rings use `--button-focus-ring`. Caret and selection colors use the incumbent accent tokens. The dialog therefore follows Owlbear's light/dark theme mapping rather than defining its own palette.

The dialog is centered and uses the viewport width minus 32px, capped at 460px. Its maximum height is `100dvh - 32px`, with vertical scrolling. Inputs fill the available width. Review paragraphs wrap anywhere so long names remain readable. Action rows wrap, and at widths up to 380px become a column. Button hover, active, disabled, sizing, and reduced-motion treatment come from shared button styles and tokens.

## Verification record and limits

The primary implementation session inspected the selector in dark and light themes and a long name at a 360×640 viewport, including recovery from a name exceeding the 80-character limit. The long review started at its heading with no horizontal overflow. No screenshot files were available for this documentation pass. This records that inspection, not an independent visual audit or measured contrast certification.

The reviewer disposition was **ship** for the source/semantic fix: both chosen-payload reads expose cancellable loading, and delayed-read tests for save and restore passed. The primary session also reported 59 database checks passing. These results are supplied verification evidence; this documentation pass inspected the source and did not rerun those checks.

The hosted named-copy migration was applied after this documentation pass; a read-only check confirmed the previous payload, date and revision were preserved, RLS enabled and three policies active. Hosted named-copy end-to-end validation remains pending deployment. Local UI inspection and database tests alone do not establish hosted end-to-end behavior.
