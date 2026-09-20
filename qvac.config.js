// QVAC SDK config (CommonJS on purpose: package.json has no "type": "module").
// Models are cached INSIDE this project (./models) so nothing is written to
// a global location and the whole thing can be deleted by removing one folder.
const path = require("path");

module.exports = {
  loggerLevel: "error",
  cacheDirectory: path.join(__dirname, "models"),
};
