import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scene = join(root, 'scene');
const bundled = join(root, 'app', 'src', 'main', 'assets', 'scene');
const vite = join(scene, 'node_modules', 'vite', 'bin', 'vite.js');

async function filesIn(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) {
      files.push(...(await filesIn(join(directory, entry.name), relative + '/')));
    } else if (entry.isFile()) {
      files.push(relative);
    } else {
      throw new Error(`Unexpected asset type: ${relative}`);
    }
  }
  return files.sort();
}

if (!existsSync(vite)) {
  console.error('Scene dependencies are missing. Run npm ci in scene first.');
  process.exit(1);
}

// Rebuild outside the project so checking freshness never overwrites stale assets.
const temporaryRoot = await realpath(tmpdir());
const temporary = await mkdtemp(join(temporaryRoot, 'island-life-scene-'));
try {
  const build = spawnSync(
    process.execPath,
    [vite, 'build', '--outDir', temporary, '--emptyOutDir'],
    {
      cwd: scene,
      stdio: 'inherit',
    },
  );
  if (build.error) throw build.error;
  if (build.status !== 0) throw new Error('The scene rebuild failed.');
  const expectedFiles = await filesIn(temporary);
  const bundledFiles = await filesIn(bundled);
  const differences = [];
  for (const file of new Set([...expectedFiles, ...bundledFiles])) {
    if (!expectedFiles.includes(file)) differences.push(`Unexpected bundled file: ${file}`);
    else if (!bundledFiles.includes(file)) differences.push(`Missing bundled file: ${file}`);
    else if (!(await readFile(join(temporary, file))).equals(await readFile(join(bundled, file)))) {
      differences.push(`Changed bundled file: ${file}`);
    }
  }
  if (differences.length > 0) {
    console.error(differences.join('\n'));
    throw new Error(
      'Android scene assets are stale. Run npm run build in scene, then include the updated assets.',
    );
  }
  console.log(`Scene bundle verified: ${expectedFiles.length} files match a fresh build.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  const cleanupTarget = await realpath(temporary);
  if (
    cleanupTarget !== temporary ||
    dirname(cleanupTarget) !== temporaryRoot ||
    !basename(cleanupTarget).startsWith('island-life-scene-')
  ) {
    console.error('Refusing to remove an unexpected scene verification directory.');
    process.exitCode = 1;
  } else {
    await rm(cleanupTarget, { recursive: true, force: true });
  }
}
