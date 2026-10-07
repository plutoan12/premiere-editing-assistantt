import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import vm from 'node:vm';

const hostURL = new URL('../host/captions.jsx', import.meta.url);
const script = existsSync(hostURL) ? readFileSync(hostURL, 'utf8') : '';
const validSRT = '1\n00:00:01,000 --> 00:00:02,500\n안녕하세요\n\n2\n00:00:03,000 --> 00:00:04,000\n두 번째 줄\n이어지는 줄\n';
const request = (changes = {}) => ({requestId: 'request-1', expectedProjectPath: '/work/edit.prproj', expectedSequenceId: 'seq-1', srtPath: '/tmp/자막.srt', cueCount: 2, ...changes});

// Only Adobe/ExtendScript boundaries are simulated; the distributed JSX is executed unchanged.
function host(options = {}) {
  const calls = [];
  const oldItem = {nodeId: 'old', getMediaPath() {return '/work/old.srt';}};
  const children = [oldItem];
  Object.defineProperty(children, 'numItems', {get() {return children.length;}});
  const rootItem = {children};
  const sequence = {
    sequenceID: 'seq-1', name: '편집 "A"',
    createCaptionTrack(item, startAtTime) {
      calls.push({kind: 'caption', itemId: item.nodeId, startAtTime});
      if (options.createThrows) throw new Error('native caption failure');
      return options.createResult ?? true;
    },
  };
  if (options.noCaptionAPI) delete sequence.createCaptionTrack;
  const project = {
    path: '/work/edit.prproj', rootItem, activeSequence: sequence,
    importFiles(paths, suppressUI, target, asStills) {
      calls.push({kind: 'import', paths: Array.from(paths), suppressUI, root: target === rootItem, asStills});
      if (options.importThrows) throw new Error('native import failure');
      if (options.importResult === false) return false;
      const mediaPath = options.importedPath ?? '/tmp/자막.srt';
      children.push({nodeId: 'new', getMediaPath() {options.duringItemMatch?.({project, sequence, app}); return mediaPath;}});
      if (options.multipleMatches) children.push({nodeId: 'another', getMediaPath() {return mediaPath;}});
      if (options.unrelatedLast) children.push({nodeId: 'unrelated', getMediaPath() {return '/tmp/unrelated.mp4';}});
      options.afterImport?.({project, sequence, app, children});
      return true;
    },
  };
  const app = {project};
  if (options.duringSnapshot) Object.defineProperty(oldItem, 'nodeId', {get() {options.duringSnapshot({project, sequence, app}); return 'old';}});
  function File(path) {
    this.fsName = path;
    this.exists = options.missingFile !== true;
    this.length = options.length ?? Buffer.byteLength(options.srt ?? validSRT);
    this.error = '';
    this.open = () => options.openResult ?? true;
    this.read = () => {
      if (options.readThrows) throw new Error('read failed');
      if (options.readError) this.error = 'read failed';
      options.afterRead?.({project, sequence, app});
      return options.srt ?? validSRT;
    };
    this.close = () => options.closeResult ?? true;
  }
  const context = vm.createContext({app, File, JSON: options.noJSON ? undefined : JSON});
  vm.runInContext(script, context, {filename: 'captions.jsx'});
  return {calls, project, sequence, children, context, inspect: () => JSON.parse(context.PeaCaptionBridge.inspect()), apply: (value = request()) => {
    assert.equal(typeof context.PeaCaptionBridge.apply, 'function', 'host must expose the validated apply operation');
    return JSON.parse(context.PeaCaptionBridge.apply(typeof value === 'string' ? value : JSON.stringify(value)));
  }};
}

test('publishes an inspectable target without changing the project', () => {
  const h = host();
  assert.equal(typeof h.context.PeaCaptionBridge, 'object');
  assert.deepEqual(h.inspect(), {projectPath: '/work/edit.prproj', sequenceId: 'seq-1', sequenceName: '편집 "A"', available: true});
  assert.deepEqual(h.calls, []);
});

test('imports the exact SRT into root and creates a new caption track at zero without touching other items', () => {
  const h = host({unrelatedLast: true});
  const result = h.apply();
  assert.equal(result.status, 'applied');
  assert.equal(result.requestId, 'request-1');
  assert.equal(result.cueCount, 2);
  assert.equal(result.sequenceId, 'seq-1');
  assert.deepEqual(h.calls, [
    {kind: 'import', paths: ['/tmp/자막.srt'], suppressUI: true, root: true, asStills: false},
    {kind: 'caption', itemId: 'new', startAtTime: 0},
  ]);
  assert.equal(h.children[0].nodeId, 'old');
});

test('blocks duplicate request IDs even after the host script is evaluated again', () => {
  const h = host();
  h.apply();
  vm.runInContext(script, h.context);
  const result = h.apply();
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'REQUEST_ALREADY_USED');
  assert.equal(h.calls.length, 2);
});

test('a missing JSON parser leaves inspect usable and apply makes no native changes', () => {
  const h = host({noJSON: true});
  assert.equal(h.inspect().sequenceName, '편집 "A"');
  assert.equal(h.apply().code, 'JSON_PARSER_UNAVAILABLE');
  assert.deepEqual(h.calls, []);
});

for (const [name, input] of [
  ['malformed JSON', '{invalid'], ['array payload', []], ['null payload', 'null'],
  ['empty request ID', request({requestId: ''})], ['unsafe request ID', request({requestId: 'x\n'})],
  ['relative SRT path', request({srtPath: 'captions.srt'})], ['non-SRT path', request({srtPath: '/tmp/captions.txt'})],
  ['path control character', request({srtPath: '/tmp/x\0.srt'})], ['URL path', request({srtPath: 'https://example.test/captions.srt'})],
  ['missing project pin', request({expectedProjectPath: ''})], ['missing sequence pin', request({expectedSequenceId: ''})],
  ['fractional cue count', request({cueCount: 1.5})], ['zero cue count', request({cueCount: 0})],
  ['excessive cue count', request({cueCount: 100001})], ['string cue count', request({cueCount: '2'})],
]) {
  test(`rejects ${name} before native mutations`, () => {
    const h = host();
    assert.equal(h.apply(input).status, 'failed');
    assert.deepEqual(h.calls, []);
  });
}

for (const [name, options] of [
  ['missing file', {missingFile: true}], ['empty file', {srt: ''}], ['oversized file', {length: 16777217}],
  ['open failure', {openResult: false}], ['read exception', {readThrows: true}], ['read error', {readError: true}],
  ['close failure', {closeResult: false}], ['invalid SRT', {srt: 'not captions'}],
  ['reversed time', {srt: validSRT.replace('00:00:02,500', '00:00:00,900')}],
  ['impossible minute', {srt: validSRT.replace('00:00:02,500', '00:99:02,500')}],
  ['empty cue', {srt: validSRT.replace('안녕하세요', '  ')}],
  ['blank text block', {srt: validSRT.replace('안녕하세요', '안녕하세요\n\nextra')}],
  ['count mismatch', {srt: validSRT.split('\n\n')[0]}],
]) {
  test(`rejects ${name} before import`, () => {
    const h = host(options);
    assert.equal(h.apply().status, 'failed');
    assert.deepEqual(h.calls, []);
  });
}

test('accepts a UTF-8 BOM and CRLF SRT without changing its timestamps', () => {
  const h = host({srt: '\uFEFF' + validSRT.replaceAll('\n', '\r\n')});
  assert.equal(h.apply().status, 'applied');
  assert.equal(h.calls[1].startAtTime, 0);
});

test('rejects a stale sequence before import', () => {
  const h = host();
  assert.equal(h.apply(request({expectedSequenceId: 'other'})).code, 'TARGET_CHANGED');
  assert.deepEqual(h.calls, []);
});

test('rejects a stale project before import', () => {
  const h = host();
  assert.equal(h.apply(request({expectedProjectPath: '/work/other.prproj'})).code, 'TARGET_CHANGED');
  assert.deepEqual(h.calls, []);
});

test('rechecks the pinned target after reading the file and before importing', () => {
  const h = host({afterRead: ({project}) => {project.activeSequence = {sequenceID: 'changed'};}});
  assert.equal(h.apply().code, 'TARGET_CHANGED');
  assert.deepEqual(h.calls, []);
});

test('checks the target immediately before importing after collecting existing media IDs', () => {
  const h = host({duringSnapshot: ({project}) => {project.path = '/work/switched.prproj';}});
  assert.equal(h.apply().code, 'TARGET_CHANGED');
  assert.deepEqual(h.calls, []);
});

test('rechecks the pinned target after import and does not create captions on a new active sequence', () => {
  const h = host({afterImport: ({project}) => {project.activeSequence = {sequenceID: 'changed'};}});
  const result = h.apply();
  assert.equal(result.status, 'failed');
  assert.equal(result.code, 'TARGET_CHANGED');
  assert.deepEqual(h.calls.map(x => x.kind), ['import']);
});

test('an unavailable caption API is reported before importing', () => {
  const h = host({noCaptionAPI: true});
  assert.equal(h.inspect().available, false);
  assert.equal(h.apply().code, 'CAPTION_API_UNAVAILABLE');
  assert.deepEqual(h.calls, []);
});

test('checks the target again immediately before creating after media item lookup', () => {
  const h = host({duringItemMatch: ({project}) => {project.path = '/work/switched.prproj';}});
  assert.equal(h.apply().code, 'TARGET_CHANGED');
  assert.deepEqual(h.calls.map(x => x.kind), ['import']);
});

for (const [name, options, expectedStatus, expectedCode] of [
  ['import false', {importResult: false}, 'failed', 'IMPORT_FAILED'],
  ['import exception', {importThrows: true}, 'unknown', 'IMPORT_RESULT_UNKNOWN'],
  ['wrong imported media', {importedPath: '/tmp/wrong.srt'}, 'failed', 'IMPORT_RESULT_AMBIGUOUS'],
  ['ambiguous imported media', {multipleMatches: true}, 'failed', 'IMPORT_RESULT_AMBIGUOUS'],
  ['caption false', {createResult: false}, 'failed', 'CAPTION_FAILED'],
  ['caption exception', {createThrows: true}, 'unknown', 'CAPTION_RESULT_UNKNOWN'],
  ['unexpected caption result', {createResult: 1}, 'unknown', 'CAPTION_RESULT_UNKNOWN'],
]) {
  test(`reports ${name} honestly and blocks a repeated request`, () => {
    const h = host(options);
    const result = h.apply();
    assert.equal(result.status, expectedStatus);
    assert.equal(result.code, expectedCode);
    const count = h.calls.length;
    assert.equal(h.apply().status, 'blocked');
    assert.equal(h.calls.length, count);
    if (name.includes('import') || name.includes('media')) assert.deepEqual(h.calls.map(x => x.kind), ['import']);
  });
}

test('does not reuse a previously imported item with the same path', () => {
  const h = host({importedPath: '/tmp/wrong.srt'});
  h.children.push({nodeId: 'stale', getMediaPath: () => '/tmp/자막.srt'});
  assert.equal(h.apply().code, 'IMPORT_RESULT_AMBIGUOUS');
  assert.deepEqual(h.calls.map(x => x.kind), ['import']);
});
