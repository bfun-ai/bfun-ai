#!/usr/bin/env node

require('dotenv').config({ path: require('path').join(process.cwd(), '.env') });

import('../src/index.js').catch((error) => {
  console.error(error);
  process.exit(1);
});
