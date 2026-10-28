// Jede Version hat Release-Notes in Worten des Nutzers
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

test('RELEASE-NOTES.md hat einen Abschnitt zur aktuellen Version', () => {
  const v = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const notes = readFileSync('RELEASE-NOTES.md', 'utf8');
  expect(notes).toContain(`## ${v}`);
});
