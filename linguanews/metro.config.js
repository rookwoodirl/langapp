const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Some packages (e.g. zustand) ship an ESM build that references
// `import.meta.env`, which breaks Metro's web bundle (it emits a single
// classic <script>, not an ES module, so `import.meta` throws a
// SyntaxError and no JS on the page runs at all). Metro resolves any
// `import`-syntax dependency via the package's "import" export condition
// regardless of `unstable_conditionNames`, so the only way to avoid the
// broken ESM build is to turn off "exports" map resolution entirely and
// fall back to resolverMainFields (main/browser), which point at the
// CJS build instead.
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
