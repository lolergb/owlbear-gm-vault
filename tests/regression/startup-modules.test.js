import { readFileSync } from 'node:fs';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

const root = new URL('../../', import.meta.url);
const oldConstantsURLs = new Set(['', '?v=20260812-1', '?v=20260815-1']);
const playerExports = /export const (?:PLAYER_DIRECTORY_STORAGE_PREFIX|PLAYER_PROFILE_METADATA_KEY|BROADCAST_CHANNEL_(?:REQUEST_PLAYER_VAULT|RESPONSE_PLAYER_VAULT|PLAYER_VAULT_UPDATED)) = .*;\n/g;

// Link the real browser module graph without executing SDK calls or touching
// vault data. Unlike Jest imports, URL query strings remain part of identity.
async function linkEntry(htmlPath, staleConstants) {
  const htmlURL = new URL(htmlPath, root);
  const html = readFileSync(htmlURL, 'utf8');
  const entry = html.match(/<script type="module" src="([^"]+)"/)[1];
  const context = createContext();
  const modules = new Map();

  function getModule(url) {
    if (modules.has(url.href)) return modules.get(url.href);
    let module;
    if (url.href === 'https://esm.sh/@owlbear-rodeo/sdk@3.1.0') {
      module = new SyntheticModule(['default'], function () {
        this.setExport('default', {});
      }, { context, identifier: url.href });
    } else {
      if (url.protocol !== 'file:') throw new Error(`Unexpected module: ${url}`);
      let source = readFileSync(url, 'utf8');
      if (staleConstants && url.pathname.endsWith('/utils/constants.js') && oldConstantsURLs.has(url.search)) {
        source = source.replace(playerExports, '');
      }
      module = new SourceTextModule(source, { context, identifier: url.href });
    }
    modules.set(url.href, module);
    return module;
  }

  const entryModule = getModule(new URL(entry, htmlURL));
  await entryModule.link((specifier, parent) => getModule(new URL(specifier, parent.identifier)));
  return entryModule.status;
}

describe.each(['index.html', 'html/background.html'])('%s startup imports', htmlPath => {
  it('links every module with a fresh cache', async () => {
    await expect(linkEntry(htmlPath, false)).resolves.toBe('linked');
  });

  it('links when pre-player-sharing constants remain cached at their old URLs', async () => {
    await expect(linkEntry(htmlPath, true)).resolves.toBe('linked');
  });
});
