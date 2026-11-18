import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../apps/server/vercel-bundle.cjs', import.meta.url), 'utf8');
const requires = [...source.matchAll(/require\((['"])(.*?)\1\)/g)].map((match) => match[2]);
const external = [...new Set(requires.filter((id) => !id.startsWith('.') && !id.startsWith('node:')))];
console.log('bytes', source.length);
console.log(external.join('\n') || '(none)');
