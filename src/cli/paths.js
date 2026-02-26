'use strict';

const path = require('node:path');
const os = require('node:os');

const SHELLM_DIR = path.join(os.homedir(), '.shellm');
const PID_FILE = path.join(SHELLM_DIR, 'shellm.pid');
const LOG_DIR = path.join(SHELLM_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'shellm.log');
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const SERVER_SCRIPT = path.resolve(__dirname, '..', 'server.js');

module.exports = { SHELLM_DIR, PID_FILE, LOG_DIR, LOG_FILE, PROJECT_ROOT, SERVER_SCRIPT };
