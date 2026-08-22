# Release checklist

Use this checklist for every stable release and for changes that affect shared runtime behavior.

## Automated gates

- [ ] CI passes the complete test suite.
- [ ] Every file in `netlify/functions` loads as ESM and exports `handler`.
- [ ] The Netlify Deploy Preview finishes successfully.
- [ ] `npm run smoke:functions -- <deploy-url>` passes against the Deploy Preview.

## Critical DM Vault flows

- [ ] Open the extension as GM and as player.
- [ ] Configure and validate a Notion token.
- [ ] Search the Notion workspace and import one small page.
- [ ] Load content that uses the default Notion configuration.
- [ ] Open a page and deliver content to a player.
- [ ] Confirm production and beta events reach Mixpanel with the correct environment properties.
- [ ] Confirm the browser console and Netlify function logs contain no new `5xx` errors.

## Cross-cutting change review

- [ ] List every file and user flow affected by the changed runtime or configuration.
- [ ] Search the entire repository for other uses of the changed pattern.
- [ ] Add one transversal regression test, not only a test for the first failing endpoint.
- [ ] Record the rollback commit before merging to `main`.
