'use strict';
const fs = require('node:fs');
const path = require('node:path');
let cached;
let stamp;
exports.read = function read() {
  const filename = path.join(__dirname, 'shared.json');
  const stat = fs.statSync(filename);
  const nextStamp = `${stat.mtimeMs}:${stat.size}`;
  if (!cached || nextStamp !== stamp) {
    const parsed = JSON.parse(fs.readFileSync(filename, 'utf8'));
    cached = parsed;
    stamp = nextStamp;
  }
  // Callers historically received independent objects. Preserve that contract.
  return structuredClone(cached);
};
