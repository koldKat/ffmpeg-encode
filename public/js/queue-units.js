function audioTrackLayoutKey(audioTracks) {
  const tracks = Array.isArray(audioTracks) ? audioTracks : [];
  if (!tracks.length) return '';
  return tracks
    .map(track => [
      track.index ?? '',
      track.language || '',
      track.codec || '',
      track.channels ?? '',
      track.title || '',
    ].join(':'))
    .join('|');
}

function sharedFolderAudioTracks(audioTrackLists) {
  const lists = (audioTrackLists || []).filter(list => Array.isArray(list) && list.length);
  if (!lists.length) return [];
  const firstKey = audioTrackLayoutKey(lists[0]);
  if (lists.every(list => audioTrackLayoutKey(list) === firstKey)) return lists[0];

  const layoutMap = new Map();
  for (const list of lists) {
    const key = audioTrackLayoutKey(list);
    const label = list.map(track => {
      const parts = [track.index ?? ''];
      if (track.language) parts.push(String(track.language).toUpperCase());
      if (track.codec) parts.push(track.codec);
      if (track.channels) parts.push(`${track.channels}ch`);
      if (track.title) parts.push(track.title);
      return parts.join(' \u00b7 ');
    }).join(' | ');
    const current = layoutMap.get(key) || { count: 0, label };
    current.count += 1;
    layoutMap.set(key, current);
  }
  return [{ mixed: true, layouts: [...layoutMap.values()] }];
}

export function buildQueueSelectionUnits(queue = [], sourceRoot = '') {
  const units = [];
  const folderMap = new Map();
  const normalizedRoot = sourceRoot === '/' ? '/' : String(sourceRoot || '').replace(/\/+$/, '');
  const rootPrefix = normalizedRoot === '/' ? '/' : `${normalizedRoot}/`;

  for (const item of Array.isArray(queue) ? queue : []) {
    const relativeDirectory = item.path === normalizedRoot
      ? '.'
      : (normalizedRoot && item.path.startsWith(rootPrefix) ? item.path.slice(rootPrefix.length) : '.');
    if (relativeDirectory === '.') {
      units.push({
        key: `file:${item.fullPath}`,
        type: 'file',
        title: item.name,
        subtitle: item.path,
        hoverPath: item.path,
        filePaths: [item.fullPath],
        tune: item.tune || 'film',
        saveTo: item.saveTo || item.path,
        audioTrack: item.audioTrack ?? 0,
        audioTracks: item.audioTracks || [],
        status: item.status || 'pending',
        deleteSource: item.deleteSource === true,
        deleteSourceItems: [{
          fullPath: item.fullPath,
          name: item.name,
          deleteSource: item.deleteSource === true,
        }],
      });
      continue;
    }

    let unit = folderMap.get(relativeDirectory);
    if (!unit) {
      unit = {
        key: `dir:${relativeDirectory}`,
        type: 'folder',
        title: relativeDirectory,
        subtitle: item.path,
        hoverPath: item.path,
        filePaths: [],
        tuneValues: new Set(),
        saveValues: new Set(),
        audioTrackValues: new Set(),
        audioTrackLists: [],
        statuses: new Set(),
        deleteSourceValues: [],
      };
      folderMap.set(relativeDirectory, unit);
      units.push(unit);
    }
    unit.filePaths.push(item.fullPath);
    unit.tuneValues.add(item.tune || 'film');
    unit.saveValues.add(item.saveTo || item.path);
    unit.audioTrackValues.add(item.audioTrack ?? 0);
    unit.audioTrackLists.push(item.audioTracks || []);
    unit.statuses.add(item.status || 'pending');
    unit.deleteSourceValues.push({
      fullPath: item.fullPath,
      name: item.name,
      deleteSource: item.deleteSource === true,
    });
  }

  return units.map(unit => {
    if (unit.type === 'file') return unit;
    return {
      key: unit.key,
      type: unit.type,
      title: unit.title,
      subtitle: `${unit.subtitle} \u2022 ${unit.filePaths.length} file(s)`,
      hoverPath: unit.hoverPath,
      filePaths: unit.filePaths,
      tune: unit.tuneValues.size === 1 ? [...unit.tuneValues][0] : 'mixed',
      saveTo: unit.saveValues.size === 1 ? [...unit.saveValues][0] : 'mixed',
      audioTrack: unit.audioTrackValues.size === 1 ? [...unit.audioTrackValues][0] : 'mixed',
      audioTracks: sharedFolderAudioTracks(unit.audioTrackLists),
      status: unit.statuses.size === 1 ? [...unit.statuses][0] : 'mixed',
      deleteSource: unit.deleteSourceValues.every(item => item.deleteSource),
      deleteSourceItems: unit.deleteSourceValues,
    };
  });
}
