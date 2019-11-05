const ErrorOverlay = require('react-error-overlay');
const Refresh = require('react-refresh/runtime');
const { runtimeGlobalHook } = require('./globals');

/**
 * Extracts exports from a webpack module object.
 * @param {*} module A Webpack module object.
 * @returns {*} An exports object from the module.
 */
function getModuleExports(module) {
  return module.exports || module.__proto__.exports;
}

/**
 * Calculates the signature of a React refresh boundary.
 * If this signature changes, it's unsafe to accept the boundary.
 *
 * This implementation is based on the one in [Metro](https://github.com/facebook/metro/blob/907d6af22ac6ebe58572be418e9253a90665ecbd/packages/metro/src/lib/polyfills/require.js#L795-L816).
 */
function getReactRefreshBoundarySignature(moduleExports) {
  const signature = [];
  signature.push(Refresh.getFamilyByType(moduleExports));

  if (moduleExports == null || typeof moduleExports !== 'object') {
    // Exit if we can't iterate over exports.
    return signature;
  }

  for (var key in moduleExports) {
    if (key === '__esModule') {
      continue;
    }

    signature.push(key);
    signature.push(Refresh.getFamilyByType(moduleExports[key]));
  }

  return signature;
}

/**
 * Creates conditional full refresh dispose handler for Webpack hot.
 * @param {*} module A Webpack module object.
 * @returns {hotDisposeCallback} A webpack hot dispose callback.
 */
function createHotDisposeCallback(module) {
  /**
   * A callback to performs a full refresh if React has unrecoverable errors,
   * and also caches the to-be-disposed module.
   * @param {*} data A hot module data object from Webpack HMR.
   * @returns {void}
   */
  function hotDisposeCallback(data) {
    if (Refresh.hasUnrecoverableErrors()) {
      window.location.reload();
    }

    // We have to mutate the data object to get data registered and cached
    data.module = module;
  }

  return hotDisposeCallback;
}

/**
 * Creates self-recovering an error handler for webpack hot.
 * @param {string} moduleId A unique ID for a Webpack module.
 * @returns {hotErrorHandler} A webpack hot error handler.
 */
function createHotErrorHandler(moduleId) {
  /*
   * An error handler to allow self-recovering behaviours.
   * @returns {void}
   */
  function hotErrorHandler() {
    require.cache[moduleId].hot.accept(hotErrorHandler);
  }

  return hotErrorHandler;
}

/**
 * Creates a helper that performs a delayed React refresh.
 * @returns {enqueueUpdate} A debounced React refresh function.
 */
function createDebounceUpdate() {
  /**
   * A cached setTimeout handler.
   * @type {number | void}
   */
  var refreshTimeout = undefined;

  /**
   * Performs react refresh on a delay.
   * @returns {void}
   */
  function enqueueUpdate() {
    if (refreshTimeout === undefined) {
      refreshTimeout = setTimeout(function() {
        refreshTimeout = undefined;
        Refresh.performReactRefresh();
        if (window[runtimeGlobalHook].hasRuntimeErrors) {
          ErrorOverlay.dismissRuntimeErrors();
          delete window[runtimeGlobalHook].hasRuntimeErrors;
        }
      }, 30);
    }
  }

  return enqueueUpdate;
}

/**
 * Checks if all exports are likely a React component.
 *
 * This implementation is based on the one in [Metro](https://github.com/facebook/metro/blob/febdba2383113c88296c61e28e4ef6a7f4939fda/packages/metro/src/lib/polyfills/require.js#L748-L774).
 * @param {*} module A Webpack module object.
 * @returns {boolean} Whether the exports are React component like.
 */
function isReactRefreshBoundary(module) {
  var moduleExports = getModuleExports(module);

  if (Refresh.isLikelyComponentType(moduleExports)) {
    return true;
  }
  if (
    moduleExports === undefined ||
    moduleExports === null ||
    typeof moduleExports !== 'object'
  ) {
    // Exit if we can't iterate over exports.
    return false;
  }

  var hasExports = false;
  var areAllExportsComponents = true;
  for (var key in moduleExports) {
    hasExports = true;

    // This is the ES Module indicator flag set by Webpack
    if (key === '__esModule') {
      continue;
    }

    // We can (and have to) safely execute getters here,
    // as Webpack manually assigns harmony exports to getters,
    // without any side-effects attached.
    // Ref: https://github.com/webpack/webpack/blob/b93048643fe74de2a6931755911da1212df55897/lib/MainTemplate.js#L281
    var exportValue = moduleExports[key];
    if (!Refresh.isLikelyComponentType(exportValue)) {
      areAllExportsComponents = false;
    }
  }

  return hasExports && areAllExportsComponents;
}

/**
 * Checks if exports are likely a React component and registers them.
 *
 * This implementation is based on the one in [Metro](https://github.com/facebook/metro/blob/febdba2383113c88296c61e28e4ef6a7f4939fda/packages/metro/src/lib/polyfills/require.js#L818-L835).
 * @param {*} module A Webpack module object.
 * @returns {void}
 */
function registerExportsForReactRefresh(module) {
  var moduleExports = getModuleExports(module);
  var moduleId = module.id;

  if (Refresh.isLikelyComponentType(moduleExports)) {
    // Register module.exports if it is likely a component
    Refresh.register(moduleExports, moduleId + ' %exports%');
  }

  if (
    moduleExports === undefined ||
    moduleExports === null ||
    typeof moduleExports !== 'object'
  ) {
    // Exit if we can't iterate over the exports.
    return;
  }

  for (var key in moduleExports) {
    // Skip registering the Webpack ES Module indicator
    if (key === '__esModule') {
      continue;
    }

    var exportValue = moduleExports[key];
    if (Refresh.isLikelyComponentType(exportValue)) {
      var typeID = moduleId + ' %exports% ' + key;
      Refresh.register(exportValue, typeID);
    }
  }
}

/**
 * Compares previous and next module objects to check for mutated boundaries.
 *
 * This implementation is based on the one in [Metro](https://github.com/facebook/metro/blob/907d6af22ac6ebe58572be418e9253a90665ecbd/packages/metro/src/lib/polyfills/require.js#L776-L792).
 */
function shouldInvalidateReactRefreshBoundary(prevModule, nextModule) {
  const prevSignature = getReactRefreshBoundarySignature(
    getModuleExports(prevModule)
  );
  const nextSignature = getReactRefreshBoundarySignature(
    getModuleExports(nextModule)
  );

  if (prevSignature.length !== nextSignature.length) {
    return true;
  }

  for (let i = 0; i < nextSignature.length; i++) {
    if (prevSignature[i] !== nextSignature[i]) {
      return true;
    }
  }

  return false;
}

module.exports = Object.freeze({
  createHotDisposeCallback,
  createHotErrorHandler,
  enqueueUpdate: createDebounceUpdate(),
  isReactRefreshBoundary,
  shouldInvalidateReactRefreshBoundary,
  registerExportsForReactRefresh,
});
