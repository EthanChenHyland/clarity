function installRuntimeCompatibility(target = globalThis) {
  const installed = [];

  if (typeof target.fetch !== 'function') {
    const nodeFetch = require('node-fetch');
    target.fetch = nodeFetch;
    target.Headers = target.Headers || nodeFetch.Headers;
    target.Request = target.Request || nodeFetch.Request;
    target.Response = target.Response || nodeFetch.Response;
    installed.push('fetch');
  }

  if (
    typeof target.ReadableStream !== 'function' ||
    typeof target.WritableStream !== 'function' ||
    typeof target.TransformStream !== 'function'
  ) {
    const webStreams = require('stream/web');
    for (const name of ['ReadableStream', 'WritableStream', 'TransformStream']) {
      if (typeof target[name] !== 'function' && typeof webStreams[name] === 'function') {
        target[name] = webStreams[name];
        installed.push(name);
      }
    }
  }

  if (typeof target.FormData !== 'function' || typeof target.Blob !== 'function' || typeof target.File !== 'function') {
    const formData = require('formdata-node');
    for (const name of ['FormData', 'Blob', 'File']) {
      if (typeof target[name] !== 'function' && typeof formData[name] === 'function') {
        target[name] = formData[name];
        installed.push(name);
      }
    }
  }

  return installed;
}

module.exports = { installRuntimeCompatibility };
