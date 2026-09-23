'use strict';

const { Router } = require('express');
const config = require('../config');
const { CONFIG_FILE } = require('../cli/paths');

const router = Router();

// GET /admin/config — the settings table `shellm config` prints, plus the bounded list of
// settings this release added that the operator's config file does not set.
router.get('/config', (_req, res) => {
  res.json({
    running: config.running(),
    config_file: CONFIG_FILE,
    settings: config.all(),
    unseen: config.unseen(),
  });
});

module.exports = router;
