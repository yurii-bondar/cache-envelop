/**
 * Loads an optional peer dependency on demand.
 *
 * The client packages are optional peers: installing this package for its Redis
 * wrapper should not drag in a Memcached client, and using only the in-process
 * `Memory` backend should drag in neither. Requiring them lazily is what makes
 * that possible — a top-level `require` would fail at import time for everyone,
 * whichever backend they actually use.
 *
 * `require.resolve` runs first so that "the package is not installed" stays
 * distinguishable from "the package is installed and threw while loading": only
 * the former is the user's cue to run an install.
 *
 * @param {string} moduleName - The package to load.
 * @param {string} wrapperName - The wrapper asking for it, named in the error.
 * @returns {any} The loaded module.
 * @throws {Error} If the package is not installed.
 */
function loadClient(moduleName, wrapperName) {
  try {
    require.resolve(moduleName);
  } catch {
    throw new Error(
      `cache-envelop: ${wrapperName} requires the "${moduleName}" package, which is not installed. `
      + `Install it with \`npm install ${moduleName}\`.`,
    );
  }

  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(moduleName);
}

module.exports = loadClient;
