'use strict';

const pkg = require('../../package.json');

function run() {
  console.log(`shellm v${pkg.version}`);
}

module.exports = { run };
