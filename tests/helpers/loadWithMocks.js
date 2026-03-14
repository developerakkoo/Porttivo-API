const Module = require('module');

const loadWithMocks = (targetPath, mocks = {}) => {
  const resolvedTarget = require.resolve(targetPath);
  const originalLoad = Module._load;

  const resolvedMocks = new Map(
    Object.entries(mocks).map(([request, mock]) => [
      Module._resolveFilename(request, {
        id: resolvedTarget,
        filename: resolvedTarget,
        paths: Module._nodeModulePaths(process.cwd()),
      }),
      mock,
    ])
  );

  delete require.cache[resolvedTarget];

  Module._load = function patchedLoad(request, parent, isMain) {
    const resolvedRequest = Module._resolveFilename(request, parent, isMain);
    if (resolvedMocks.has(resolvedRequest)) {
      return resolvedMocks.get(resolvedRequest);
    }

    return originalLoad(request, parent, isMain);
  };

  try {
    return require(resolvedTarget);
  } finally {
    Module._load = originalLoad;
  }
};

module.exports = {
  loadWithMocks,
};
