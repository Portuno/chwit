import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const folder = readdirSync(path.join(root, 'node_modules/.pnpm')).find((name) => name.startsWith('esbuild@'));
if (!folder) throw new Error('No está esbuild. Corré pnpm install.');

const require = createRequire(path.join(root, 'node_modules/.pnpm', folder, 'node_modules/esbuild/package.json'));
const esbuild = require('esbuild');

await esbuild.build({
  absWorkingDir: root,
  entryPoints: ['apps/server/dist/vercel.js'],
  outfile: 'api/[...path].js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  legalComments: 'none',
  footer: { js: 'module.exports = module.exports.default;' },
});
