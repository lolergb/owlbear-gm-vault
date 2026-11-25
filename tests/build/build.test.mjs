import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';
import { buildSite, publicBuildEnvironment } from '../../scripts/build.mjs';

const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const outdir = path.join(root, '.build/artifact-test');
const ref = 'a'.repeat(40);
const secret = 'DO_NOT_PUBLISH_PRIVATE_ENV_SENTINEL';
let result;
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
const local = url => url && !/^(?:[a-z]+:|\/\/|#)/i.test(url);
const isModule = node => node.tagName === 'script' && attr(node, 'type') === 'module';
const isLocalStyle = node => node.tagName === 'link' && attr(node, 'rel') === 'stylesheet' && local(attr(node, 'href'));
function allNodes(node) { return [node, ...(node.childNodes || []).flatMap(allNodes)]; }
function markup(node) {
  if (isModule(node) || isLocalStyle(node) || node.nodeName === '#comment') return null;
  if (node.nodeName === '#text') return node.value.trim() || null;
  return { name: node.nodeName, attrs: node.attrs,
    children: (node.childNodes || []).map(markup).filter(value => value !== null) };
}

before(async () => {
  result = await buildSite({ outdir, env: { CONTEXT: 'production', COMMIT_REF: ref,
    DEBUG_MODE: 'true', GM_VAULT_DEFAULT_CONFIG_V2: secret, MIXPANEL_TOKEN: secret } });
});

test('all six pages preserve markup and reference existing hashed assets', async () => {
  const pages = ['index.html', ...(await readdir(path.join(root, 'html'))).filter(name => name.endsWith('.html')).map(name => `html/${name}`)];
  assert.equal(pages.length, 6);
  for (const file of pages) {
    const source = parse(await readFile(path.join(root, file), 'utf8'));
    const output = parse(await readFile(path.join(outdir, file), 'utf8'));
    assert.deepEqual(markup(output), markup(source), file);
    const nodes = allNodes(output);
    const scripts = nodes.filter(isModule);
    assert.equal(scripts.length, 1, file);
    for (const node of [...scripts, ...nodes.filter(isLocalStyle)]) {
      const url = attr(node, node.tagName === 'script' ? 'src' : 'href');
      assert.match(url, /^\/assets\/[\w-]+-[A-Z0-9]{8}\.(js|css)$/);
      await access(path.join(outdir, url));
    }
    if (file === 'index.html') assert.equal(nodes.filter(isLocalStyle).length, 2);
  }
});

test('CSS preserves source order and the two groups stay around the external stylesheet', async () => {
  const index = parse(await readFile(path.join(outdir, 'index.html'), 'utf8'));
  const styles = allNodes(index).filter(node => node.tagName === 'link' && attr(node, 'rel') === 'stylesheet');
  assert.match(attr(styles[0], 'href'), /index-styles-0/);
  assert.match(attr(styles[1], 'href'), /^https:\/\/fonts.googleapis.com/);
  assert.match(attr(styles[2], 'href'), /index-styles-1/);
  const inputs = Object.entries(result.metafile.outputs)
    .filter(([file]) => /index-styles-\d-.*\.css$/.test(file))
    .flatMap(([, meta]) => Object.keys(meta.inputs).filter(file => file.endsWith('.css')));
  assert.deepEqual(inputs, ['css/ui-rendering.css', 'css/button-tokens.css', 'css/app.css', 'css/ui-typography.css',
    'css/notion-markdown.css', 'css/vault-empty-state.css', 'css/modal-select.css', 'css/cloud-backup.css']);
});

test('JS has no local module waterfall or late local chunks; CSS assets resolve', async () => {
  assert(Object.keys(result.metafile.inputs).every(file => !/[?#]/.test(file)));
  for (const [file, meta] of Object.entries(result.metafile.outputs)) {
    for (const dependency of meta.imports) {
      if (file.endsWith('.js')) {
        assert.equal(dependency.external, true, dependency.path);
        assert.match(dependency.path, /^https:\/\//);
      } else if (!dependency.external) {
        await access(path.resolve(root, dependency.path));
      }
    }
  }
});

test('publish directory retains compatibility URLs but excludes repository and credentials', async () => {
  for (const file of ['manifest.json', 'icon.svg', 'docs/store.md', 'js/main.js', 'css/app.css', 'public/default-config.json']) {
    assert.deepEqual(await readFile(path.join(outdir, file)), await readFile(path.join(root, file)));
  }
  for (const file of ['.git', '.env', 'node_modules', 'tests', 'netlify', 'package.json', '.build', 'scripts']) {
    await assert.rejects(access(path.join(outdir, file)));
  }
  for (const file of Object.keys(result.metafile.outputs)) {
    assert.equal((await readFile(path.resolve(root, file), 'utf8')).includes(secret), false, file);
  }
  assert.equal(result.buildRef, ref);
  assert.match(await readFile(path.join(outdir, 'js/utils/buildRef.js'), 'utf8'), new RegExp(ref));
  assert.equal((await readFile(path.join(root, 'js/utils/buildRef.js'), 'utf8')).includes(ref), false);
});

test('identical inputs have stable URLs; changed provenance invalidates affected JS', async () => {
  const again = await buildSite({ outdir: path.join(root, '.build/repeat-test'),
    env: { CONTEXT: 'production', COMMIT_REF: ref } });
  assert.deepEqual(again.outputs, result.outputs);
  const changed = await buildSite({ outdir: path.join(root, '.build/changed-test'),
    env: { CONTEXT: 'production', COMMIT_REF: 'b'.repeat(40) } });
  assert.notEqual(changed.outputs['index-module-0'], result.outputs['index-module-0']);
  assert.equal(changed.outputs['index-styles-1'], result.outputs['index-styles-1']);
});

test('public environment disables production debug and classifies previews without secrets', () => {
  const manifest = { name: 'GM Vault', version: '2.2.0' };
  assert.deepEqual(result.environment, { context: 'production', debug: false, isBeta: false });
  assert.deepEqual(publicBuildEnvironment({ CONTEXT: 'deploy-preview', DEBUG_MODE: 'true', SECRET: secret }, manifest),
    { context: 'deploy-preview', debug: true, isBeta: true });
  assert.equal(publicBuildEnvironment({ CONTEXT: 'production' }, { ...manifest, name: 'GM Vault Beta' }).isBeta, true);
  assert.throws(() => publicBuildEnvironment({ CONTEXT: 'unexpected' }, manifest));
});

test('Netlify publishes only dist and gives hashed assets immutable caching', async () => {
  const config = await readFile(path.join(root, 'netlify.toml'), 'utf8');
  assert.match(config, /\[build\]\s+command = "npm run build"\s+publish = "dist"/);
  assert.match(config, /for = "\/assets\/\*"\s+\[headers.values\]\s+Cache-Control = "public, max-age=31536000, immutable"/);
  assert.match(config, /for = "\/html\/\*\.html"\s+\[headers.values\]\s+Cache-Control = "public, max-age=0, must-revalidate"/);
});
