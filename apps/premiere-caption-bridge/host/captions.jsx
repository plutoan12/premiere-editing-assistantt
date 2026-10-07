/* ES3 host bridge. Caption import/create calls follow Adobe-CEP/Samples PProPanel:
 * https://github.com/Adobe-CEP/Samples/blob/e4946b73ac1e566dced8e95dba10811c31036927/PProPanel/jsx/PPRO/Premiere.jsx#L2923-L2980
 * JSON2 must be loaded by the CEP bootstrap before apply() is used.
 */
var PeaCaptionBridge;
(function () {
    // Re-evaluating the CEP bootstrap must not erase attempted request IDs.
    var requests = PeaCaptionBridge && PeaCaptionBridge._requests ? PeaCaptionBridge._requests : {};
    function quote(value) {
        return '"' + String(value).replace(/[\\"\u0000-\u001f\u2028\u2029]/g, function (character) {
            var code = character.charCodeAt(0).toString(16);
            if (character === '"' || character === '\\') { return '\\' + character; }
            return '\\u' + ('0000' + code).slice(-4);
        }) + '"';
    }

    // All public responses are flat records; this does not require JSON globals.
    function response(value) {
        var result = [], key, item;
        for (key in value) {
            if (Object.prototype.hasOwnProperty.call(value, key)) {
                item = value[key];
                result.push(quote(key) + ':' + (typeof item === 'string' ? quote(item) : String(item)));
            }
        }
        return '{' + result.join(',') + '}';
    }

    function target() {
        var project = app.project;
        var sequence = project ? project.activeSequence : null;
        return {project: project, sequence: sequence};
    }

    function inspect() {
        var current, projectPath = '', sequenceId = '', sequenceName = '', available = false;
        try {
            current = target();
            projectPath = current.project && current.project.path ? String(current.project.path) : '';
            sequenceId = current.sequence && current.sequence.sequenceID ? String(current.sequence.sequenceID) : '';
            sequenceName = current.sequence && current.sequence.name ? String(current.sequence.name) : '';
            available = !!(projectPath && sequenceId && typeof current.sequence.createCaptionTrack === 'function');
        } catch (ignored) {}
        return response({projectPath: projectPath, sequenceId: sequenceId, sequenceName: sequenceName, available: available});
    }

    function absolutePath(value) {
        return typeof value === 'string' && value.length > 0 && value.length <= 4096 &&
            !/[\u0000-\u001f\u007f]/.test(value) && (/^\//.test(value) || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]+\\/.test(value));
    }

    function validRequest(value) {
        return value && Object.prototype.toString.call(value) === '[object Object]' &&
            typeof value.requestId === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value.requestId) &&
            absolutePath(value.expectedProjectPath) && typeof value.expectedSequenceId === 'string' &&
            value.expectedSequenceId.length > 0 && value.expectedSequenceId.length <= 256 &&
            absolutePath(value.srtPath) && /\.srt$/i.test(value.srtPath) &&
            typeof value.cueCount === 'number' && value.cueCount >= 1 && value.cueCount <= 100000 &&
            Math.floor(value.cueCount) === value.cueCount;
    }

    function isPinned(current, request) {
        return current.project && current.sequence &&
            String(current.project.path) === request.expectedProjectPath &&
            String(current.sequence.sequenceID) === request.expectedSequenceId;
    }

    function timeMilliseconds(parts, start) {
        return ((Number(parts[start]) * 60 + Number(parts[start + 1])) * 60 + Number(parts[start + 2])) * 1000 + Number(parts[start + 3]);
    }

    function validSRT(text, count) {
        if (typeof text !== 'string' || text.length === 0 || text.length > 16777216 || /\u0000/.test(text)) { return false; }
        var normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+$/, '');
        var blocks = normalized.split(/\n[ \t]*\n/), i, lines, times, body;
        if (blocks.length !== count) { return false; }
        for (i = 0; i < blocks.length; i++) {
            lines = blocks[i].split('\n');
            if (lines.length < 3 || lines[0] !== String(i + 1)) { return false; }
            times = /^(\d{2,6}):([0-5]\d):([0-5]\d),(\d{3}) --> (\d{2,6}):([0-5]\d):([0-5]\d),(\d{3})$/.exec(lines[1]);
            if (!times || timeMilliseconds(times, 5) <= timeMilliseconds(times, 1)) { return false; }
            body = lines.slice(2).join('\n');
            if (!/\S/.test(body)) { return false; }
        }
        return true;
    }

    function readSRT(path, count) {
        var file = new File(path), text, opened = false, closed = true;
        if (!file.exists || file.length <= 0 || file.length > 16777216) { return null; }
        try {
            file.encoding = 'UTF-8';
            opened = file.open('r');
            if (!opened) { return null; }
            text = file.read();
            if (file.error) { return null; }
        } finally {
            if (opened) { closed = file.close(); }
        }
        if (!closed || !validSRT(text, count)) { return null; }
        return file.fsName;
    }

    function itemIDs(root) {
        var result = {}, i, item;
        for (i = 0; i < root.children.numItems; i++) {
            item = root.children[i];
            result['$' + String(item.nodeId)] = true;
        }
        return result;
    }

    function importedItem(root, previousIDs, path) {
        var found = null, i, item, mediaPath;
        for (i = 0; i < root.children.numItems; i++) {
            item = root.children[i];
            if (previousIDs['$' + String(item.nodeId)]) { continue; }
            try { mediaPath = item.getMediaPath(); } catch (ignored) { continue; }
            if (typeof mediaPath === 'string' && mediaPath === path) {
                if (found) { return null; }
                found = item;
            }
        }
        return found;
    }

    function failure(requestId, status, code, message) {
        return response({requestId: requestId, status: status, code: code, message: message});
    }

    function apply(requestJson) {
        var request, requestId = '', current, path, root, previousIDs, item, nativeResult, stage = 'validation';
        if (typeof JSON === 'undefined' || typeof JSON.parse !== 'function') {
            return failure('', 'failed', 'JSON_PARSER_UNAVAILABLE', '자막 연결 기능을 다시 불러와 주세요. JSON 읽기 기능이 없습니다.');
        }
        try {
            if (typeof requestJson !== 'string' || requestJson.length > 16384) { throw new Error('invalid request'); }
            request = JSON.parse(requestJson);
            if (!validRequest(request)) { throw new Error('invalid request'); }
            requestId = request.requestId;
        } catch (invalidRequest) {
            return failure('', 'failed', 'INVALID_REQUEST', '적용 요청의 파일 경로 또는 대상 정보가 올바르지 않습니다.');
        }
        if (requests['$' + requestId]) {
            return failure(requestId, 'blocked', 'REQUEST_ALREADY_USED', '이미 처리한 요청입니다. 타임라인의 결과를 먼저 확인해 주세요.');
        }
        requests['$' + requestId] = true;
        try {
            current = target();
            if (!isPinned(current, request)) {
                return failure(requestId, 'failed', 'TARGET_CHANGED', '선택한 프로젝트나 시퀀스가 바뀌었습니다. 대상을 다시 확인해 주세요.');
            }
            if (typeof current.sequence.createCaptionTrack !== 'function') {
                return failure(requestId, 'failed', 'CAPTION_API_UNAVAILABLE', '이 Premiere에서는 캡션 트랙 직접 적용 기능을 사용할 수 없습니다.');
            }
            path = readSRT(request.srtPath, request.cueCount);
            if (!path) {
                return failure(requestId, 'failed', 'SRT_NOT_READABLE', '자막 파일을 읽을 수 없거나 자막 형식·개수가 일치하지 않습니다.');
            }
            current = target();
            if (!isPinned(current, request)) {
                return failure(requestId, 'failed', 'TARGET_CHANGED', '파일을 읽는 동안 적용 대상이 바뀌었습니다.');
            }
            root = current.project.rootItem;
            previousIDs = itemIDs(root);
            current = target();
            if (!isPinned(current, request)) {
                return failure(requestId, 'failed', 'TARGET_CHANGED', '프로젝트 항목을 확인하는 동안 적용 대상이 바뀌었습니다.');
            }
            stage = 'import';
            nativeResult = current.project.importFiles([path], true, root, false);
            if (nativeResult === false) {
                return failure(requestId, 'failed', 'IMPORT_FAILED', 'Premiere가 자막 가져오기를 거절했습니다. 프로젝트 패널을 확인해 주세요.');
            }
            if (nativeResult !== true) {
                return failure(requestId, 'unknown', 'IMPORT_RESULT_UNKNOWN', '자막 가져오기 결과를 확인할 수 없습니다. 자동으로 다시 적용하지 않습니다.');
            }
            current = target();
            if (!isPinned(current, request)) {
                return failure(requestId, 'failed', 'TARGET_CHANGED', '가져온 뒤 적용 대상이 바뀌었습니다. 자막 파일은 프로젝트에 남아 있을 수 있습니다.');
            }
            item = importedItem(root, previousIDs, path);
            if (!item) {
                return failure(requestId, 'failed', 'IMPORT_RESULT_AMBIGUOUS', '가져온 자막 파일을 확실히 식별할 수 없어 트랙 생성을 중단했습니다.');
            }
            current = target();
            if (!isPinned(current, request)) {
                return failure(requestId, 'failed', 'TARGET_CHANGED', '자막 항목을 확인하는 동안 적용 대상이 바뀌어 트랙 생성을 중단했습니다.');
            }
            // SRT timestamps already contain the document offset. Never add it twice.
            stage = 'caption';
            nativeResult = current.sequence.createCaptionTrack(item, 0);
            if (nativeResult === false) {
                return failure(requestId, 'failed', 'CAPTION_FAILED', 'Premiere가 캡션 트랙 생성을 거절했습니다. 타임라인을 확인해 주세요.');
            }
            if (nativeResult !== true) {
                return failure(requestId, 'unknown', 'CAPTION_RESULT_UNKNOWN', '캡션 트랙 생성 결과를 확인할 수 없습니다. 타임라인을 확인하고 중복 적용을 피하세요.');
            }
            return response({status: 'applied', requestId: requestId, code: 'NATIVE_APPLY_SUCCEEDED', message: 'Premiere가 새 캡션 트랙 생성을 완료했다고 응답했습니다. 타임라인에서 결과를 확인해 주세요.', projectPath: request.expectedProjectPath, sequenceId: request.expectedSequenceId, cueCount: request.cueCount});
        } catch (error) {
            if (stage === 'caption') {
                return failure(requestId, 'unknown', 'CAPTION_RESULT_UNKNOWN', '캡션 생성 중 오류가 발생했습니다. 일부 적용되었을 수 있으므로 타임라인을 먼저 확인해 주세요.');
            }
            if (stage === 'import') {
                return failure(requestId, 'unknown', 'IMPORT_RESULT_UNKNOWN', '자막 가져오기 중 오류가 발생했습니다. 프로젝트를 확인하고 중복 적용을 피하세요.');
            }
            return failure(requestId, 'failed', 'VALIDATION_FAILED', '대상 정보 또는 자막 파일을 확인하지 못해 적용을 시작하지 않았습니다.');
        }
    }

    PeaCaptionBridge = {inspect: inspect, apply: apply, _requests: requests};
}());
