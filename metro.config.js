// yjs -> lib0/random.js -> lib0/webcrypto picks lib0's package.json "react-native" export
// condition, which points at the abandoned `isomorphic-webcrypto` package. Redirect the
// "lib0/webcrypto" subpath itself to our local shim — see
// src/platform/crypto/getRandomValues.ts, which exports the same
// { getRandomValues, subtle } shape as lib0's own working browser variant.

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
const upstreamResolveRequest = config.resolver.resolveRequest;

// tsconfig.json's "paths": { "src/*": ["./src/*"] } only affects tsc's type-checking — Metro
// needs its own equivalent, or `import ... from 'src/ui/theme'` fails to bundle at runtime.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  src: path.resolve(__dirname, 'src'),
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'lib0/webcrypto') {
    return {
      type: 'sourceFile',
      filePath: path.resolve(__dirname, 'src/platform/crypto/getRandomValues.ts'),
    };
  }
  if (upstreamResolveRequest) {
    return upstreamResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
