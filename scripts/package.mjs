import { packager } from '@electron/packager'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const [platform = process.platform, arch = process.arch] = process.argv.slice(2)
const { name, version, productName, description, main } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const electron = JSON.parse(await readFile(join(root, 'node_modules/electron/package.json'), 'utf8'))
const stage = await mkdtemp(join(tmpdir(), 'kontur-package-'))

try {
  await cp(join(root, 'dist'), join(stage, 'dist'), { recursive: true })
  await cp(join(root, 'desktop'), join(stage, 'desktop'), { recursive: true })
  await cp(join(root, 'LICENSE'), join(stage, 'LICENSE'))
  await writeFile(join(stage, 'package.json'), JSON.stringify({ name, version, productName, description, main }))
  const outputs = await packager({
    dir: stage,
    out: join(root, 'out'),
    name: 'Kontur',
    electronVersion: electron.version,
    platform,
    arch,
    asar: true,
    overwrite: true,
    download: { cacheRoot: process.env.electron_config_cache },
  })
  for (const output of outputs) console.log(output)
} finally {
  await rm(stage, { recursive: true, force: true })
}
