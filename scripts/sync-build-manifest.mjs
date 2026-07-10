import fs from 'node:fs';
const built = JSON.parse(fs.readFileSync('dist/_build/plugin.json', 'utf8'));
const root = JSON.parse(fs.readFileSync('plugin.json', 'utf8'));
root.entryHash = built.entryHash || root.entryHash || '';
root.zipHash = built.zipHash || root.zipHash || '';
fs.writeFileSync('plugin.json', JSON.stringify(root, null, 2) + '\n');
