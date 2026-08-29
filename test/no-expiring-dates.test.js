const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * No test may post a date that today will overtake.
 *
 * This has now broken the build twice. A test written on the 10th posts
 * '2026-08-10', passes all day, and fails at midnight — because the
 * assign route refuses a date in the past, so a valid request becomes a
 * 400 and the suite reports a bug that does not exist. The second time
 * it was '2026-08-19' and '2026-08-22', found by CI eighteen days later.
 *
 * A suite that cries wolf on a date boundary is one people learn to
 * re-run rather than read, and the next failure is the real one. So the
 * rule is checked rather than remembered: a date sent to the API must be
 * relative to now.
 *
 * Fixed dates are still right for a pure function given an explicit
 * `today` — that is a calculation with no clock in it, and those files
 * are untouched by this.
 */

const TEST_DIR = __dirname;

function testFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return testFiles(full);
    return e.name.endsWith('.test.js') ? [full] : [];
  });
}

test('no test posts a hard-coded date to the API', () => {
  const offenders = [];

  for (const file of testFiles(TEST_DIR)) {
    if (file.endsWith('no-expiring-dates.test.js')) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');

    lines.forEach((line, i) => {
      // Only a request body counts. A fixed date handed to a pure
      // function alongside an explicit `today` is a calculation with no
      // clock in it, and those are fine — this is about dates the server
      // will compare against the real date when the suite happens to run.
      const window = lines.slice(Math.max(0, i - 4), i + 1).join(' ');
      if (!/\.send\(/.test(window)) return;
      if (!/\b(cleaning_date|date|from|to):\s*'\d{4}-\d{2}-\d{2}'/.test(line)) return;
      offenders.push(`${path.relative(TEST_DIR, file)}:${i + 1}  ${line.trim()}`);
    });
  }

  assert.deepEqual(
    offenders, [],
    'These will fail once today passes them. Use a date relative to now:\n  ' +
    offenders.join('\n  ')
  );
});
