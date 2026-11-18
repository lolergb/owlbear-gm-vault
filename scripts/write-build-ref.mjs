import { writeFileSync } from 'node:fs';

// Only a full Git SHA can enter the public artifact. Local builds stay unknown.
const ref = /^[a-f0-9]{40}$/i.test(process.env.COMMIT_REF || '')
  ? process.env.COMMIT_REF.toLowerCase()
  : 'unknown';
writeFileSync(new URL('../js/utils/buildRef.js', import.meta.url),
  `// Generated at build time.\nexport const BUILD_REF = '${ref}';\n`);
