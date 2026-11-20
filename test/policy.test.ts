import assert from 'node:assert/strict';
import { test } from 'node:test';

import { distill } from '../src/distill/policy.ts';
import {
  classifyTool,
  decideGate,
  editedPath,
  gateMessage,
  newGateState,
} from '../src/gate/policy.ts';
import { suggestGateCommand } from '../src/gate/detect.ts';
import { loadConfig } from '../src/policy.ts';
import { decideEscalation, escalationCandidates, toolErrorWindow } from '../src/router/policy.ts';

const config = loadConfig({} as NodeJS.ProcessEnv);

test('distill leaves a short result untouched', () => {
  const result = distill('ok\n');
  assert.equal(result.changed, false);
  assert.equal(result.text, 'ok\n');
});

test('distill keeps head, tail and failure-looking lines', () => {
  const lines: string[] = [];
  for (let index = 0; index < 2000; index += 1) {
    lines.push(index === 900 ? 'ERROR: boom at line 900' : `line ${index}`);
  }
  const result = distill(`${lines.join('\n')}\n`);
  assert.equal(result.changed, true);
  assert.ok(result.text.includes('line 0'));
  assert.ok(result.text.includes('line 1999'));
  assert.ok(result.text.includes('ERROR: boom at line 900'));
  assert.ok(result.text.includes('omitted'));
  assert.ok(result.text.length < 20000);
});

test('distill falls back to a character window for one enormous line', () => {
  const blob = 'x'.repeat(50_000);
  const result = distill(blob);
  assert.equal(result.changed, true);
  assert.ok(result.text.length < 7000);
  assert.ok(result.text.includes('omitted'));
});

test('distill honours a custom budget', () => {
  const text = Array.from({ length: 500 }, (_, index) => `row ${index}`).join('\n');
  assert.equal(distill(text, { maxChars: 100 }).changed, true);
  assert.equal(distill(text, { maxChars: 100_000 }).changed, false);
});

test('classifyTool separates edits, verification and everything else', () => {
  assert.equal(classifyTool('edit', {}, config), 'edit');
  assert.equal(classifyTool('write', {}, config), 'edit');
  assert.equal(classifyTool('py_validation_bundle', {}, config), 'verify');
  assert.equal(classifyTool('bash', { command: 'uv run pytest -q' }, config), 'verify');
  assert.equal(classifyTool('bash', { command: 'cargo test -p core' }, config), 'verify');
  assert.equal(classifyTool('bash', { command: 'ls -la' }, config), 'other');
  assert.equal(classifyTool('read', { path: 'a.py' }, config), 'other');
});

test('editedPath only reports file tools', () => {
  assert.equal(editedPath('edit', { path: 'src/a.ts' }), 'src/a.ts');
  assert.equal(editedPath('bash', { path: 'src/a.ts' }), undefined);
  assert.equal(editedPath('edit', {}), undefined);
});

test('decideGate fires only for unverified edits, once', () => {
  const state = newGateState();
  assert.equal(decideGate({ state, aborted: false }).fire, false);

  state.edited.add('a.py');
  state.lastEditAt = 10;
  state.lastVerifyAt = 0;
  assert.equal(decideGate({ state, aborted: false }).fire, true);

  state.lastVerifyAt = 11;
  assert.equal(decideGate({ state, aborted: false }).fire, false);

  state.lastVerifyAt = 0;
  state.fired = true;
  assert.equal(decideGate({ state, aborted: false }).fire, false);

  const aborted = newGateState();
  aborted.edited.add('a.py');
  aborted.lastEditAt = 10;
  assert.equal(decideGate({ state: aborted, aborted: true }).fire, false);
});

test('gateMessage names the files and the suggested command', () => {
  const message = gateMessage(['a.py', 'b.py'], 'python3 -m unittest -q');
  assert.ok(message.includes('a.py, b.py'));
  assert.ok(message.includes('python3 -m unittest -q'));
  assert.ok(message.includes('Verification gate'));
});

test('suggestGateCommand prefers a declared script', () => {
  const cwd = 'evals/fixtures/fix-off-by-one';
  assert.equal(suggestGateCommand(cwd), 'python3 -m unittest -q');
  assert.equal(suggestGateCommand('definitely-not-a-project-dir'), undefined);
});

test('toolErrorWindow counts failures in the current user turn only', () => {
  assert.deepEqual(toolErrorWindow([]), { errors: 0, lastIsError: false, sawTool: false });

  // A failed call is always followed by an assistant turn before the next one,
  // so the scan must look past assistant messages instead of stopping at them.
  assert.deepEqual(
    toolErrorWindow([
      { role: 'user', content: 'fix it' },
      { role: 'toolResult', isError: true },
      { role: 'assistant', content: [] },
      { role: 'toolResult', isError: true },
      { role: 'assistant', content: [] },
    ]),
    { errors: 2, lastIsError: true, sawTool: true },
  );

  // An earlier turn's failures do not leak into a new user request.
  assert.deepEqual(
    toolErrorWindow([
      { role: 'toolResult', isError: true },
      { role: 'toolResult', isError: true },
      { role: 'user', content: 'try another way' },
    ]),
    { errors: 0, lastIsError: false, sawTool: false },
  );

  assert.deepEqual(
    toolErrorWindow([
      { role: 'user', content: 'go' },
      { role: 'toolResult', isError: true },
      { role: 'assistant', content: [] },
      { role: 'toolResult', isError: false },
    ]),
    { errors: 1, lastIsError: false, sawTool: true },
  );
});

test('decideEscalation escalates on retry, repeated failures and recovers on success', () => {
  const fresh = { escalated: false };
  const failing = { errors: 2, lastIsError: true, sawTool: true };
  const recovered = { errors: 2, lastIsError: false, sawTool: true };

  assert.equal(
    decideEscalation({ window: failing, threshold: 2, retryFailed: true, state: fresh }).escalate,
    true,
  );
  assert.equal(
    decideEscalation({
      window: { errors: 1, lastIsError: true, sawTool: true },
      threshold: 2,
      retryFailed: false,
      state: fresh,
    }).escalate,
    false,
  );
  assert.equal(
    decideEscalation({ window: failing, threshold: 2, retryFailed: false, state: fresh }).escalate,
    true,
  );
  assert.equal(
    decideEscalation({
      window: failing,
      threshold: 2,
      retryFailed: false,
      state: { escalated: true },
    }).reason,
    'sticky',
  );
  assert.equal(
    decideEscalation({
      window: recovered,
      threshold: 2,
      retryFailed: false,
      state: { escalated: true },
    }).escalate,
    false,
  );
});

test('escalationCandidates can be overridden by env', () => {
  assert.deepEqual(
    escalationCandidates({ PI_FLASH_ESCALATE_MODELS: 'a:cloud, b:cloud' } as NodeJS.ProcessEnv),
    ['a:cloud', 'b:cloud'],
  );
  assert.ok(escalationCandidates({} as NodeJS.ProcessEnv).length > 0);
});
