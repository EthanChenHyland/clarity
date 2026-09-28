const base = require('./electron-builder.cjs');

// Electron 22 is the final Electron major that supports Windows 7/8/8.1.
// Keep this target isolated so normal Clarity builds can continue using a
// current Electron release.
module.exports = {
  ...base,
  electronVersion: '22.3.27',
  directories: {
    ...base.directories,
    output: 'dist-win7',
  },
  artifactName: '${productName}-${version}-win7-${arch}.${ext}',
  win: {
    ...base.win,
    target: [{ target: 'nsis', arch: ['x64'] }],
    artifactName: '${productName}-${version}-win7-${arch}.${ext}',
  },
};
