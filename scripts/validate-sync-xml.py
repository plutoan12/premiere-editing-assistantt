"""Independent structural checks, not a Premiere importer/host acceptance test."""
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlparse, unquote

path = Path(sys.argv[1])
root = ET.parse(path).getroot()
assert root.tag == 'xmeml' and root.get('version') == '5'
sequences = root.findall('sequence')
assert len(sequences) == 1
sequence = sequences[0]
assert sequence.findtext('updatebehavior') == 'add'
items = sequence.findall('.//clipitem')
ids = [item.get('id') for item in items]
assert len(ids) == len(set(ids)) and len(items) >= 2
files = {f.get('id'): f for f in sequence.findall('.//file') if f.find('pathurl') is not None}
for item in items:
    start, end, source_in, source_out = [int(item.findtext(k)) for k in ('start', 'end', 'in', 'out')]
    assert 0 <= start < end <= int(sequence.findtext('duration'))
    assert source_in == 0 and source_out - source_in == end - start
    source = files[item.find('file').get('id')]
    url = urlparse(source.findtext('pathurl'))
    assert url.scheme == 'file' and Path(unquote(url.path)).is_file()
    for link in item.findall('link/linkclipref'):
        assert link.text in ids
if '--demo' in sys.argv:
    starts = {x.findtext('name'): int(x.findtext('start')) for x in items}
    assert starts['camera-b.mov'] == 33 and starts['camera-a.mov'] == 0 and starts['recorder.wav'] == 0
print(json.dumps({'xml_structure': 'passed', 'clips': len(items), 'files': len(files), 'premiere_host': 'not_run'}))
