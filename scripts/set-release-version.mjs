import fs from 'node:fs';
const version = process.argv[2];
if (!version) throw new Error('version argument is required');
for (const file of ['package.json', 'plugin.json']) {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  json.version = version;
  if (file === 'plugin.json') {
    const repo = process.env.GITHUB_REPOSITORY || 'yourname/songloft-plugin-lxmusic';
    json.download_url = `https://github.com/${repo}/releases/download/v${version}/lxmusic.jsplugin.zip`;
    json.updateUrl = `https://raw.githubusercontent.com/${repo}/main/plugin.json`;
  }
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
}
