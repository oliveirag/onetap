const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// shared/ holds type-only cross-team contracts at the repo root.
config.watchFolders = [path.resolve(__dirname, '../shared')];

module.exports = config;
