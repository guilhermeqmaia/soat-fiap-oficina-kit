// Instala o tarball gerado por `npm pack` num projeto vazio e importa cada
// subpath — pega erro de `exports`, de `files` e de dependencia esquecida
// antes de publicar.
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const tarball = join('/tmp', `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`);
const dir = mkdtempSync(join(tmpdir(), 'kit-smoke-'));
const peers = Object.keys(pkg.peerDependencies).filter(
  (p) => !pkg.peerDependenciesMeta?.[p]?.optional,
);
writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'smoke', private: true }));
execSync(
  `npm install --no-audit --no-fund ${tarball} ${peers.map((p) => `${p}@"${pkg.peerDependencies[p]}"`).join(' ')}`,
  { cwd: dir, stdio: 'inherit' },
);
const subpaths = [
  '',
  '/core',
  '/auth',
  '/logging',
  '/metrics',
  '/health',
  '/messaging',
  '/testing',
];
const script = subpaths
  .map(
    (s) =>
      `require('reflect-metadata'); const m${s.replace('/', '')} = require('${pkg.name}${s}'); if (!Object.keys(m${s.replace('/', '')}).length) throw new Error('subpath vazio: ${s}');`,
  )
  .join('\n');
writeFileSync(
  join(dir, 'smoke.js'),
  script + `\nconsole.log('smoke ok: ${subpaths.length} subpaths importaveis');`,
);
execSync('node smoke.js', { cwd: dir, stdio: 'inherit' });
