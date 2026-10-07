#!/usr/bin/env node
// Explicit, project-local macOS arm64 setup for the real-model acceptance test.
// No global install, paid service, voice download, or source-media upload.
import { createHash } from 'node:crypto';
import { createReadStream, closeSync, openSync } from 'node:fs';
import { access, copyFile, mkdir, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = join(root, 'build/deps/subtitle');
const sources = [
  {
    name: 'cmake', version: '4.4.4', archive: 'cmake-4.4.4.tar.gz', directory: 'cmake-4.4.4-macos-universal',
    url: 'https://github.com/Kitware/CMake/releases/download/v4.4.4/cmake-4.4.4-macos-universal.tar.gz',
    sha256: '4b7b73704b1db9b374e5c9ab8e17ac6148b817b6396ee75cd94a852cbac9d305'
  },
  {
    name: 'whisper.cpp', version: 'v1.9.4', revision: '927cfce34f31707e17f2bff35c349632fb9e2c3a',
    archive: 'whisper-927cfce.tar.gz', directory: 'whisper.cpp-927cfce34f31707e17f2bff35c349632fb9e2c3a',
    url: 'https://github.com/ggml-org/whisper.cpp/archive/927cfce34f31707e17f2bff35c349632fb9e2c3a.tar.gz',
    sha256: '41b664fee09e79176ac277b5237debec34f8d74af3c7d71f333f1ec67989ecde'
  },
  {
    name: 'FFmpeg', version: 'n9.0.2', revision: '946fcce07b6dcd0331c8cc609192aeff5e1924f8',
    archive: 'ffmpeg-946fcce.tar.gz', directory: 'FFmpeg-946fcce07b6dcd0331c8cc609192aeff5e1924f8',
    url: 'https://github.com/FFmpeg/FFmpeg/archive/946fcce07b6dcd0331c8cc609192aeff5e1924f8.tar.gz',
    sha256: '0aa2b1de2a5698b20a23e93d539a9a8e82ca0117496c5bdf05d198805f42bb3b'
  },
  {
    name: 'Whisper multilingual base', archive: 'ggml-base.bin',
    revision: '5359861c739e955e79d9a303bcbc70fb988958b1',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.bin',
    sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe'
  }
];

async function sha256(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}
async function exists(path) { try { await access(path); return true; } catch { return false; } }
function run(command, args, { cwd = root, log } = {}) {
  const fd = log ? openSync(log, 'a') : undefined;
  try {
    const result = spawnSync(command, args, { cwd, stdio: fd === undefined ? 'inherit' : ['ignore', fd, fd] });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} failed with ${result.status}; see ${log ?? 'output above'}`);
  } finally { if (fd !== undefined) closeSync(fd); }
}
async function download(source) {
  const path = join(base, 'downloads', source.archive);
  if (!(await exists(path))) {
    console.log(`Downloading ${source.name} into ignored build/deps`);
    const partial = `${path}.part`;
    run('/usr/bin/curl', ['--fail', '--location', '--silent', '--show-error', '--retry', '2', '--connect-timeout', '20', '--max-time', '300', source.url, '--output', partial]);
    if (await sha256(partial) !== source.sha256) throw new Error(`Checksum mismatch for ${source.name}; partial file was not installed`);
    await rename(partial, path);
  }
  if (await sha256(path) !== source.sha256) throw new Error(`Checksum mismatch for cached ${source.name}; refusing to execute or extract it`);
  return path;
}

async function setup() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This acceptance setup supports macOS arm64 only');
  for (const directory of ['downloads', 'src', 'models', 'reports', 'fixtures']) await mkdir(join(base, directory), { recursive: true });
  for (const source of sources) {
    const archive = await download(source);
    if (source.directory && !(await exists(join(base, 'src', source.directory)))) run('/usr/bin/tar', ['-xzf', archive, '-C', join(base, 'src')]);
  }
  const cmake = join(base, 'src', sources[0].directory, 'CMake.app/Contents/bin/cmake');
  const whisperBuild = join(base, 'whisper-build');
  const whisperLog = join(base, 'reports/whisper-build.log');
  console.log('Building whisper-cli with Metal enabled');
  run(cmake, ['-S', join(base, 'src', sources[1].directory), '-B', whisperBuild, '-DCMAKE_BUILD_TYPE=Release', '-DWHISPER_BUILD_TESTS=OFF', '-DWHISPER_BUILD_SERVER=OFF', '-DGGML_METAL=ON'], { log: whisperLog });
  run(cmake, ['--build', whisperBuild, '--target', 'whisper-cli', '-j', '4'], { log: whisperLog });
  const ffmpegSource = join(base, 'src', sources[2].directory);
  const ffmpegLog = join(base, 'reports/ffmpeg-build.log');
  // GitHub source archives omit VERSION. Without it FFmpeg can discover the
  // enclosing application's Git SHA and incorrectly report that as its version.
  await writeFile(join(ffmpegSource, 'VERSION'), sources[2].version.slice(1) + '\n');
  const ffmpegConfiguration = [`--prefix=${join(base, 'ffmpeg')}`, '--disable-autodetect', '--disable-doc', '--disable-debug', '--disable-network', '--disable-ffplay'];
  console.log('Building FFmpeg and FFprobe without external codec libraries or network protocols');
  run('./configure', ffmpegConfiguration, { cwd: ffmpegSource, log: ffmpegLog });
  run('/usr/bin/make', ['-j', '4'], { cwd: ffmpegSource, log: ffmpegLog });
  run('/usr/bin/make', ['install'], { cwd: ffmpegSource, log: ffmpegLog });
  const model = join(base, 'models/ggml-base.bin');
  if (await exists(model)) {
    if (await sha256(model) !== sources[3].sha256) throw new Error('Existing installed model checksum does not match; refusing to overwrite it');
  } else {
    const partial = `${model}.${process.pid}.part`;
    await copyFile(join(base, 'downloads/ggml-base.bin'), partial);
    if (await sha256(partial) !== sources[3].sha256) throw new Error('Installed model copy checksum mismatch');
    await rename(partial, model);
  }
  const paths = {
    ffmpeg: join(base, 'ffmpeg/bin/ffmpeg'), ffprobe: join(base, 'ffmpeg/bin/ffprobe'),
    whisper: join(whisperBuild, 'bin/whisper-cli'), model
  };
  const artifacts = {};
  for (const [name, path] of Object.entries(paths)) artifacts[name] = { path, bytes: (await stat(path)).size, sha256: await sha256(path) };
  const runtimeLibraries = [];
  for (const entry of await readdir(join(whisperBuild, 'bin'), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.dylib')) continue;
    const path = join(whisperBuild, 'bin', entry.name);
    runtimeLibraries.push({ path, bytes: (await stat(path)).size, sha256: await sha256(path) });
  }
  const version = (path, flag) => {
    const result = spawnSync(path, [flag], { encoding: 'utf8' });
    if (result.error || result.status !== 0) throw result.error ?? new Error(`Cannot execute ${path}`);
    return `${result.stdout}${result.stderr}`.trim().split('\n')[0];
  };
  const manifest = {
    createdAt: new Date().toISOString(), platform: process.platform, architecture: process.arch,
    sources, artifacts, runtimeLibraries, ffmpegConfiguration,
    generatedSourceMetadata: { 'FFmpeg/VERSION': sources[2].version.slice(1) },
    versions: { ffmpeg: version(paths.ffmpeg, '-version'), whisper: version(paths.whisper, '--version') },
    scope: 'Local acceptance dependencies only. Metal is enabled at build time; model quality and actual acceleration require a separate test.'
  };
  await writeFile(join(base, 'provenance.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify(paths, null, 2));
  console.log(`Provenance: ${join(base, 'provenance.json')}`);
}

if (process.argv.slice(2).length === 1 && process.argv[2] === '--setup') {
  await setup();
} else if (process.argv.length === 2 || process.argv[2] === '--help') {
  console.log('Usage: node scripts/setup-subtitle-model.mjs --setup\nDownloads checksum-pinned official sources/model and builds into ignored build/deps/subtitle. Requires Apple clang/make. No global installation.');
} else {
  throw new Error('Unknown option. Use --help or explicitly --setup.');
}
