import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function has(path: string, name: string): boolean {
  return existsSync(join(path, name));
}

/**
 * Picks the cheapest command that actually verifies the project.
 *
 * The order is deliberate: a declared script wins over a convention, because a
 * repository that declares `pnpm lint && pnpm test` wants both. The result is a
 * suggestion in the gate message, never something the extension runs itself.
 */
export function suggestGateCommand(cwd: string): string | undefined {
  const pkg = has(cwd, 'package.json') ? readJson(join(cwd, 'package.json')) : undefined;
  if (pkg) {
    const scripts = pkg['scripts'];
    if (typeof scripts === 'object' && scripts !== null) {
      const names = Object.keys(scripts as Record<string, unknown>);
      const runner = has(cwd, 'pnpm-lock.yaml')
        ? 'pnpm'
        : has(cwd, 'yarn.lock')
          ? 'yarn'
          : has(cwd, 'bun.lockb')
            ? 'bun'
            : 'npm';
      for (const candidate of ['test', 'check', 'verify', 'lint']) {
        if (names.includes(candidate)) return `${runner} run ${candidate}`;
      }
    }
  }

  if (has(cwd, 'Cargo.toml')) return 'cargo test';
  if (has(cwd, 'Taskfile.yml') || has(cwd, 'Taskfile.yaml')) return 'task check';
  if (has(cwd, 'pyproject.toml')) return 'uv run pytest -q';
  if (has(cwd, 'Makefile')) return 'make check';
  if (has(cwd, 'go.mod')) return 'go test ./...';

  // A bare directory of Python modules with tests and no manifest: unittest
  // discovery needs no configuration, so the presence of a test module is enough.
  try {
    for (const entry of readdirSync(cwd)) {
      if (/^test_.*\.py$/.test(entry)) return 'python3 -m unittest -q';
    }
  } catch {
    return undefined;
  }
  return undefined;
}
