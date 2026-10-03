'use strict';

function problem(code) { const error = new Error(code); error.code = code; return error; }
function parseSession(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.protocolVersion !== 1 ||
      typeof value.sessionToken !== 'string' || !/^[0-9a-f]{64}$/.test(value.sessionToken) ||
      typeof value.address !== 'string') throw problem('INVALID_SESSION');
  // Match the literal authority before URL normalization (which accepts alternate numeric IP spellings).
  const match = /^https:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(value.address);
  if (!match || Number(match[1]) > 65535) throw problem('HTTPS_LOOPBACK_REQUIRED');
  return {address: value.address, sessionToken: value.sessionToken, protocolVersion: 1};
}
function jobId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(id)) throw problem('INVALID_JOB_ID');
  return id;
}
function createClient(bootstrap, options = {}) {
  const session = parseSession(bootstrap);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = options.timeoutMs === undefined ? 15000 : options.timeoutMs;
  if (typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw problem('INVALID_CLIENT');
  async function request(path, method = 'GET', input) {
    const abort = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(problem('TIMEOUT')); }, timeoutMs); });
    const work = (async () => {
      let response;
      try {
        response = await fetchImpl(session.address + path, {
          method, redirect: 'error', signal: abort.signal,
          headers: {'content-type': 'application/json', authorization: `Bearer ${session.sessionToken}`, 'x-pea-protocol-version': '1'},
          ...(input === undefined ? {} : {body: JSON.stringify(input)})
        });
      } catch { throw problem(abort.signal.aborted ? 'TIMEOUT' : 'NETWORK_OR_TLS'); }
      if (response.redirected || (response.status >= 300 && response.status < 400)) throw problem('REDIRECT');
      // Never relay server-controlled text, paths, certificates or tokens into the UI.
      if (!response.ok) throw problem(`HTTP_${Number(response.status) || 0}`);
      if (response.status === 204) return null;
      const length = response.headers.get('content-length');
      if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > 65536)) throw problem('RESPONSE_TOO_LARGE');
      if (!/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')) throw problem('INVALID_RESPONSE');
      const text = await response.text();
      if (text.length > 65536) throw problem('RESPONSE_TOO_LARGE');
      let result;
      try { result = JSON.parse(text); } catch { throw problem('INVALID_RESPONSE'); }
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw problem('INVALID_RESPONSE');
      return result;
    })();
    try { return await Promise.race([work, timeout]); }
    finally { clearTimeout(timer); }
  }
  return {
    async ping() {
      const response = await request('/v1/ping');
      if (response.protocolVersion !== 1 || response.ok !== true || !Array.isArray(response.capabilities) || !response.capabilities.includes('sync')) throw problem('SYNC_UNSUPPORTED');
      return response;
    },
    async submit(input) {
      const response = await request('/v1/jobs', 'POST', {kind: 'sync', input});
      jobId(response.id);
      if (response.kind !== 'sync' || !['queued', 'running'].includes(response.status)) throw problem('INVALID_RESPONSE');
      return response;
    },
    async getJob(id) { return request(`/v1/jobs/${jobId(id)}`); },
    async cancel(id) { return request(`/v1/jobs/${jobId(id)}/cancel`, 'POST', {}); },
    async remove(id) { return request(`/v1/jobs/${jobId(id)}`, 'DELETE'); }
  };
}
module.exports = {parseSession, createClient};
