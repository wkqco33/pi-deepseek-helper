/**
 * Verify the published tarball before it exists.
 *
 * `files` in package.json is easy to get wrong in a way no test notices: the
 * tests ship, or a runtime file the `pi` manifest points at is missing. Both are
 * cheap to check here and impossible to fix after `npm publish`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const REQUIRED = [
  'package.json',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'extensions/index.ts',
  'extensions/gate.ts',
  'extensions/distill.ts',
  'extensions/router.ts',
  'src/policy.ts',
  'scripts/eval.ts',
  'evals/tasks/fix-off-by-one.json',
  'evals/fixtures/fix-off-by-one/rolling.py',
];

const FORBIDDEN_PREFIXES = ['test/', 'node_modules/', '.work/', '.github/', 'coverage/', '__pycache__/'];
const FORBIDDEN_SUFFIXES = ['.pyc', '.tgz'];

const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
});

// npm changed this shape between builds: 11.x returns an array of manifests,
// while a newer build returns an object keyed by package name.
const parsed = JSON.parse(raw);
const manifest = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];

if (!manifest || !Array.isArray(manifest.files)) {
  console.error(`unexpected \`npm pack --json\` shape: ${raw.slice(0, 200)}`);
  process.exit(1);
}

const files = new Set(manifest.files.map((entry) => entry.path));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const problems = [];
for (const required of REQUIRED) {
  if (!files.has(required)) problems.push(`missing from the tarball: ${required}`);
}
for (const prefix of FORBIDDEN_PREFIXES) {
  const leaked = [...files].filter((path) => path.startsWith(prefix));
  if (leaked.length > 0) problems.push(`must not ship: ${leaked.slice(0, 3).join(', ')}`);
}
for (const suffix of FORBIDDEN_SUFFIXES) {
  const leaked = [...files].filter((path) => path.endsWith(suffix));
  if (leaked.length > 0) problems.push(`must not ship: ${leaked.slice(0, 3).join(', ')}`);
}
if (manifest.version !== pkg.version) {
  problems.push(`packed version ${manifest.version} does not match package.json ${pkg.version}`);
}
if (manifest.name !== pkg.name) {
  problems.push(`packed name ${manifest.name} does not match package.json ${pkg.name}`);
}

// A pi package whose manifest points at a file the tarball does not contain
// installs cleanly and then loads nothing, which is the worst failure mode.
for (const entry of pkg.pi?.extensions ?? []) {
  const rel = entry.replace(/^\.\//, '').replace(/\/$/, '');
  const present = files.has(rel) || [...files].some((path) => path.startsWith(`${rel}/`));
  if (!present) problems.push(`pi manifest points at a missing path: ${rel}`);
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(
  `tarball ok: ${manifest.name}@${manifest.version}, ${files.size} files, ${manifest.unpackedSize} bytes`,
);
