/**
 * Campaign shown by the beta build.
 *
 * Keep this value `null` when there is no active announcement. To activate a
 * campaign, replace it with an object matching this shape:
 *
 * {
 *   id: 'gm-vault-updated',
 *   version: 1,
 *   audience: { roles: ['GM', 'PLAYER'] },
 *   title: 'GM Vault has been updated',
 *   message: 'A short explanation of what changed.',
 *   maxViews: 3,
 *   dismissLabel: 'Got it',
 *   actions: [
 *     {
 *       id: 'read-more',
 *       label: 'See what changed',
 *       url: 'https://example.com/changelog',
 *       variant: 'primary'
 *     }
 *   ]
 * }
 *
 * Changing either `id` or `version` starts fresh view and dismissal state for
 * every user. Actions are optional and only http(s) URLs are rendered.
 */
export const ACTIVE_ANNOUNCEMENT_CAMPAIGN = null;

