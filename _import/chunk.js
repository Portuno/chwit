const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const files = execSync('git ls-files -z', { cwd: root }).toString('utf8').split('\0').filter(Boolean);
const chunks = [];
let current = [];
let size = 0;
for (const file of files) {
  const content = fs.readFileSync(path.join(root, file), 'utf8');
  if (size + content.length > 60000 && current.length) {
    chunks.push(current);
    current = [];
    size = 0;
  }
  current.push({ path: file.replaceAll('\\', '/'), content });
  size += content.length;
}
if (current.length) chunks.push(current);
chunks.forEach((chunk, index) => {
  const dest = path.join(__dirname, `chunk${index}.json`);
  fs.writeFileSync(dest, JSON.stringify(chunk));
  console.log(`${index} files=${chunk.length} bytes=${chunk.reduce((sum, item) => sum + item.content.length, 0)}`);
});
