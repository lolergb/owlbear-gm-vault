import { build } from 'esbuild';
import { parse } from 'parse5';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const localUrl = value => value && !/^(?:[a-z]+:|\/\/|#)/i.test(value);
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;

export function publicBuildEnvironment(env, manifest) {
  const context = env.CONTEXT || 'production';
  if (!['production', 'deploy-preview', 'branch-deploy', 'dev'].includes(context)) {
    throw new Error(`Unsupported build context: ${context}`);
  }
  return {
    context,
    isBeta: context !== 'production' || /beta/i.test(`${manifest.name} ${manifest.version}`),
    debug: context !== 'production' && ['true', '1'].includes(env.DEBUG_MODE)
  };
}

export async function buildSite({ outdir = path.join(ROOT, 'dist'), env = process.env } = {}) {
  outdir = path.resolve(outdir);
  if (outdir !== path.join(ROOT, 'dist') && !outdir.startsWith(`${path.join(ROOT, '.build')}${path.sep}`)) {
    throw new Error('Build output must be dist or a directory inside .build');
  }
  const manifest = JSON.parse(await readFile(path.join(ROOT, 'manifest.json'), 'utf8'));
  const environment = publicBuildEnvironment(env, manifest);
  const buildRef = /^[a-f0-9]{40}$/i.test(env.COMMIT_REF || '') ? env.COMMIT_REF.toLowerCase() : 'unknown';
  const entries = new Map();
  const documents = [];
  const files = ['index.html', ...(await readdir(path.join(ROOT, 'html')))
    .filter(name => name.endsWith('.html')).sort().map(name => `html/${name}`)];

  function localPath(url, directory) {
    const clean = url.split(/[?#]/)[0];
    return clean.startsWith('/') ? path.join(ROOT, clean) : path.resolve(directory, clean);
  }

  for (const file of files) {
    const source = await readFile(path.join(ROOT, file), 'utf8');
    const document = parse(source, { sourceCodeLocationInfo: true });
    const replacements = [];
    const directory = path.dirname(path.join(ROOT, file));
    const name = path.basename(file, '.html');
    let scriptIndex = 0;
    let styleIndex = 0;

    function visit(parent) {
      const children = parent.childNodes || [];
      for (let i = 0; i < children.length; i++) {
        const node = children[i];
        if (node.tagName === 'script' && attr(node, 'type') === 'module') {
          const src = attr(node, 'src');
          if (!src || localUrl(src)) {
            const id = `${name}-module-${scriptIndex++}`;
            const contents = src
              ? `import ${JSON.stringify(localPath(src, directory))};`
              : source.slice(node.sourceCodeLocation.startTag.endOffset, node.sourceCodeLocation.endTag.startOffset);
            entries.set(id, { contents, loader: 'js', resolveDir: directory });
            replacements.push({ start: node.sourceCodeLocation.startOffset, end: node.sourceCodeLocation.endOffset,
              render: outputs => `<script type="module" src="${outputs[id]}"></script>` });
          }
        }
        const isLocalStyle = item => item.tagName === 'link' && attr(item, 'rel') === 'stylesheet'
          && localUrl(attr(item, 'href')) && item.attrs.every(a => ['rel', 'href'].includes(a.name));
        if (isLocalStyle(node)) {
          const group = [node];
          // Keep the cascade position: never merge across an external stylesheet,
          // inline style, script or other element. Whitespace/comments are harmless.
          let j = i + 1;
          for (; j < children.length; j++) {
            const next = children[j];
            if (next.nodeName === '#comment' || (next.nodeName === '#text' && !next.value.trim())) continue;
            if (!isLocalStyle(next)) break;
            group.push(next);
          }
          const id = `${name}-styles-${styleIndex++}`;
          entries.set(id, { contents: group.map(link => `@import ${JSON.stringify(localPath(attr(link, 'href'), directory))};`).join('\n'),
            loader: 'css', resolveDir: directory });
          group.forEach((link, n) => replacements.push({ start: link.sourceCodeLocation.startOffset,
            end: link.sourceCodeLocation.endOffset,
            render: outputs => n === 0 ? `<link rel="stylesheet" href="${outputs[id]}">` : '' }));
          i = j - 1;
        }
        visit(node);
      }
    }
    visit(document);
    documents.push({ file, source, replacements });
  }

  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  // Retain the source URLs for already-open pre-bundle sessions and external
  // consumers. New documents only load hashed bundles. Never publish the repo.
  for (const item of ['js', 'css', 'img', 'fonts', 'public', 'content-demo', 'icon.svg', 'manifest.json', 'docs/store.md']) {
    await mkdir(path.dirname(path.join(outdir, item)), { recursive: true });
    await cp(path.join(ROOT, item), path.join(outdir, item), {
      recursive: true, filter: source => !path.basename(source).startsWith('.')
    });
  }

  const result = await build({
    absWorkingDir: ROOT,
    entryPoints: [...entries.keys()].map(id => ({ in: `html-entry:${id}`, out: id })),
    outdir: path.join(outdir, 'assets'), entryNames: '[name]-[hash]', assetNames: '[name]-[hash]',
    bundle: true, splitting: false, format: 'esm', platform: 'browser', target: 'es2020',
    minify: true, keepNames: true, metafile: true, legalComments: 'eof',
    loader: { '.woff2': 'file', '.woff': 'file', '.png': 'file', '.svg': 'file' },
    plugins: [{
      name: 'html-and-public-build-metadata',
      setup(builder) {
        builder.onResolve({ filter: /^html-entry:/ }, args => ({ path: args.path.slice(11), namespace: 'html-entry' }));
        builder.onLoad({ filter: /.*/, namespace: 'html-entry' }, args => entries.get(args.path));
        builder.onResolve({ filter: /^(?:https?:)?\/\// }, args => ({ path: args.path, external: true }));
        builder.onResolve({ filter: /[?#]/ }, args => {
          if (!args.path.startsWith('.') && !args.path.startsWith('/')) return;
          return { path: path.resolve(args.resolveDir, args.path.split(/[?#]/)[0]) };
        });
        builder.onLoad({ filter: /[/\\]config[/\\]buildEnvironment\.js$/ }, () => ({
          contents: `export const BUILD_ENVIRONMENT = ${JSON.stringify(environment)};`, loader: 'js'
        }));
        builder.onLoad({ filter: /[/\\]utils[/\\]buildRef\.js$/ }, () => ({
          contents: `export const BUILD_REF = ${JSON.stringify(buildRef)};`, loader: 'js'
        }));
      }
    }]
  });
  const outputs = {};
  for (const [file, meta] of Object.entries(result.metafile.outputs)) {
    if (meta.entryPoint?.startsWith('html-entry:')) {
      outputs[meta.entryPoint.slice(11)] = `/${path.relative(outdir, path.resolve(ROOT, file)).split(path.sep).join('/')}`;
    }
  }
  for (const { file, source, replacements } of documents) {
    let html = source;
    for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
      html = html.slice(0, replacement.start) + replacement.render(outputs) + html.slice(replacement.end);
    }
    await mkdir(path.dirname(path.join(outdir, file)), { recursive: true });
    await writeFile(path.join(outdir, file), html);
  }
  // Keep the unbundled compatibility copy's provenance accurate too.
  await writeFile(path.join(outdir, 'js/utils/buildRef.js'), `export const BUILD_REF = ${JSON.stringify(buildRef)};\n`);
  await mkdir(path.join(ROOT, '.build'), { recursive: true });
  await writeFile(path.join(ROOT, '.build/metafile.json'), JSON.stringify(result.metafile, null, 2));
  console.log(`Built ${documents.length} HTML pages into ${path.relative(ROOT, outdir)} (${environment.context}).`);
  return { outputs, metafile: result.metafile, environment, buildRef };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await buildSite();
}
