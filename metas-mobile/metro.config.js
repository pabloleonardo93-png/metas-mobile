const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const gitDirectoryPattern = /[\\/]\.git[\\/].*/;

config.resolver.blockList = new RegExp(
  `(?:${config.resolver.blockList.source})|(?:${gitDirectoryPattern.source})`,
);

module.exports = config;
