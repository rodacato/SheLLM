'use strict';

const path = require('node:path');
const os = require('node:os');

const SHELLM_DIR = path.join(os.homedir(), '.shellm');
const DB_FILE = path.join(SHELLM_DIR, 'shellm.db');
const PID_FILE = path.join(SHELLM_DIR, 'shellm.pid');
const LOG_DIR = path.join(SHELLM_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'shellm.log');
const CONFIG_FILE = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'shellm', 'env');
const BACKUP_DIR = '/var/lib/shellm/backups';
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const SERVER_SCRIPT = path.resolve(__dirname, '..', 'server.js');
const CLI_SCRIPT = path.resolve(__dirname, '..', 'cli.js');

module.exports = { SHELLM_DIR, DB_FILE, CONFIG_FILE, PID_FILE, LOG_DIR, LOG_FILE, BACKUP_DIR, PROJECT_ROOT, SERVER_SCRIPT, CLI_SCRIPT };
