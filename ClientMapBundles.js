'use strict';

// This backend does not host UGC bundles. Return the 0.79.2 DTO rather
// than Express's HTML 404 page. Replace this catalog if UGC hosting is added.
function getClientMapBundles(_req, res) {
  res.json({ Bundles: [], BundleHash: '' });
}

module.exports = { getClientMapBundles };
