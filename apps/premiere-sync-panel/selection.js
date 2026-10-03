'use strict';

function projectKey(project) {
  const guid = project && project.guid && project.guid.toString();
  if (typeof guid !== 'string' || !guid || guid === '[object Object]') throw new Error('PROJECT_ID_UNAVAILABLE');
  return JSON.stringify([guid, typeof project.path === 'string' ? project.path : '']);
}
function sameSelection(a, b) {
  if (!a || !b || a.projectKey !== b.projectKey || !Array.isArray(a.clips) || !Array.isArray(b.clips)) return false;
  const keys = value => value.clips.map(c => JSON.stringify([c.clipId, c.path])).sort();
  return JSON.stringify(keys(a)) === JSON.stringify(keys(b));
}
async function readSelection(ppro) {
  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error('NO_ACTIVE_PROJECT');
  const key = projectKey(project);
  const selected = await ppro.ProjectUtils.getSelection(project);
  const items = selected && await selected.getItems();
  if (!Array.isArray(items) || items.length < 2 || items.length > 16) throw new Error('SELECT_2_TO_16_SOURCE_CLIPS');
  const clips = [], ids = new Set();
  for (const item of items) {
    const clip = ppro.ClipProjectItem.cast(item);
    if (!clip) throw new Error('SOURCE_CLIPS_ONLY');
    for (const name of ['isOffline', 'isSequence', 'isMergedClip', 'isMulticamClip']) {
      if (typeof clip[name] !== 'function' || await clip[name]()) throw new Error('UNSUPPORTED_SOURCE_CLIP');
    }
    const id = await item.getId(), path = await clip.getMediaFilePath();
    if (typeof id !== 'string' || !id || id.length > 256 || ids.has(id)) throw new Error('INVALID_CLIP_ID');
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\x00-\x1f]/.test(path)) throw new Error('LOCAL_ORIGINAL_MEDIA_REQUIRED');
    ids.add(id);
    clips.push({clipId: id, name: typeof item.name === 'string' ? item.name : id, path, startSample: '0'});
  }
  const current = await ppro.Project.getActiveProject();
  if (projectKey(current) !== key) throw new Error('PROJECT_CHANGED');
  return {projectKey: key, clips};
}
module.exports = {readSelection, sameSelection};
