const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * No test may send the server a date that today will overtake.
 *
 * This has broken the build twice. A test written on the 19th posts
 * '2026-08-19', passes all day, and fails once the date goes by — the
 * assign route refuses a day that has gone, so a valid request becomes a
 * 400 and the suite reports a bug that does not exist. The second time it
 * took six tests down on three unrelated pull requests.
 *
 * A suite that cries wolf on a date boundary is one people learn to
 * re-run rather than read, and the next failure is the real one. So it is
 * checked rather than remembered.
 *
 * Fixed dates stay correct where no clock is involved. A pure function
 * given an explicit `today` is a calculation, and pinning its inputs is
 * what makes it reproducible — those files are untouched by this, and
 * they pass with the clock wound three thousand days forward.
 */

const TEST_DIR = __dirname;

function testFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return testFiles(full);
    return e.name.endsWith('.test.js') ? [full] : [];
  });
}

test('no test sends the server a hard-coded date', () => {
  const offenders = [];

  for (const file of testFiles(TEST_DIR)) {
    if (file.endsWith('no-expiring-dates.test.js')) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');

    lines.forEach((line, i) => {
      // Only a request body counts — that is the date the running system
      // will hold against the present.
      const window = lines.slice(Math.max(0, i - 4), i + 1).join(' ');
      if (!/\.send\(/.test(window)) return;
      if (!/\b(cleaning_date|date|from|to):\s*'\d{4}-\d{2}-\d{2}'/.test(line)) return;
      offenders.push(`${path.relative(TEST_DIR, file)}:${i + 1}  ${line.trim()}`);
    });
  }

  assert.deepEqual(
    offenders, [],
    'A date sent to the server must say what it means — inDays() for a day ' +
    'still ahead, daysAgo() for one gone by (test/helpers/dates.js):\n  ' +
    offenders.join('\n  ')
  );
});

test('a completed clean is never dated in the future', () => {
  // The other half of "make the date make sense". A job marked completed
  // with a date that has not arrived is a contradiction the database will
  // happily store and no assertion would catch.
  const offenders = [];

  for (const file of testFiles(TEST_DIR)) {
    if (file.endsWith('no-expiring-dates.test.js')) continue;
    const src = fs.readFileSync(file, 'utf8');
    const re = /'completed'[\s\S]{0,80}?'(\d{4}-\d{2}-\d{2})'|'(\d{4}-\d{2}-\d{2})'[^\n]{0,80}'completed'/g;
    let m;
    while ((m = re.exec(src))) {
      const date = m[1] || m[2];
      if (date > new Date().toISOString().slice(0, 10)) {
        offenders.push(`${path.relative(TEST_DIR, file)}  completed clean dated ${date}`);
      }
    }
  }

  assert.deepEqual(offenders, [], 'Use daysAgo() for something that has already happened:\n  ' +
    offenders.join('\n  '));
});
