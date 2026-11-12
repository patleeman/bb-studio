const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert'), child = require('child_process');
const root = path.resolve(process.argv[2] ?? __dirname);
const core = path.join(root, 'core');
const asar = require(path.join(core, 'node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar'));
const bundle = path.join(core, 'apps/desktop/release-staging/mac-arm64/bb Native Staging.app');
const archive = path.join(bundle, 'Contents/Resources/app.asar');
const pkg = JSON.parse(asar.extractFile(archive, 'package.json'));
const policy = JSON.parse(asar.extractFile(archive, 'dist/desktop-build-policy.json'));
const main = asar.extractFile(archive, 'dist/main.js').toString();
const plist = JSON.parse(child.execFileSync('plutil', ['-convert', 'json', '-o', '-', '--', path.join(bundle, 'Contents/Info.plist')], {encoding:'utf8'}));
const forbiddenStrings = ['electron-updater', 'quitAndInstall', 'desktop-latest', 'desktop-nightly', 'dev.bb.desktop.ShipIt'].filter(x => main.includes(x));
const forbiddenInputs = policy.inputs.filter(x => /electron-updater|desktop-update-runtime\.ts$/.test(x));
const updateFiles = fs.readdirSync(path.join(bundle, 'Contents/Resources')).filter(x => /update.*\.(yml|json)$/.test(x));
assert.equal(policy.staging, true); assert.equal(policy.updaterRuntimeIncluded, false);
assert.equal(forbiddenInputs.length, 0); assert.equal(forbiddenStrings.length, 0); assert.equal(updateFiles.length, 0);
assert.equal(pkg.name, 'bb-native-staging'); assert.equal(pkg.bbDesktopStaging, true);
assert.equal(plist.CFBundleIdentifier, 'dev.bb.qa.native-staging'); assert.equal(plist.CFBundleExecutable, 'bb Native Staging');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const evidence = {
  bundle, appVersion: pkg.version, packageName: pkg.name, appId: plist.CFBundleIdentifier, productName: plist.CFBundleName,
  policy: {staging: policy.staging, updaterRuntimeIncluded: policy.updaterRuntimeIncluded, forbiddenInputs},
  forbiddenStrings, updateFiles,
  retainedInactiveUpdaterFileEntries: asar.listPackage(archive).filter(x => x.includes('electron-updater')).length,
  asarSha256: hash(archive), mainSha256: crypto.createHash('sha256').update(main).digest('hex'),
  binarySha256: hash(path.join(bundle, 'Contents/MacOS/bb Native Staging')),
  infoPlistSha256: hash(path.join(bundle, 'Contents/Info.plist')),
  inspectionDoesNotLaunchApp: true
};
fs.writeFileSync(path.join(root, 'bundle-inspection.json'), JSON.stringify(evidence,null,2)+'\n');
process.stdout.write(JSON.stringify(evidence,null,2)+'\n');
