const bundled = require('../apps/server/vercel-bundle.cjs');

module.exports = bundled.default || bundled;
