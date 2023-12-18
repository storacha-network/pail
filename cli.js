#!/usr/bin/env node
import fs from 'fs'
import os from 'os'
import { join } from 'path'
import { Readable } from 'stream'
import sade from 'sade'
import { CID } from 'multiformats/cid'
import { CarIndexedReader, CarReader, CarWriter } from '@ipld/car'
import clc from 'cli-color'
import archy from 'archy'
// eslint-disable-next-line no-unused-vars
import * as API from './src/api.js'
import { put, get, del, entries } from './src/index.js'
import { ShardFetcher, ShardBlock, MaxShardSize } from './src/shard.js'
import { difference } from './src/diff.js'
import { merge } from './src/merge.js'

const cli = sade('pail')
  .option('--path', 'Path to data store.', './pail.car')

cli.command('put <key> <value>')
  .describe('Put a value (a CID) for the given key. If the key exists it\'s value is overwritten.')
  .alias('set')
  .option('--max-shard-size', 'Maximum shard size in bytes.', MaxShardSize)
  .action(async (key, value, opts) => {
    const maxShardSize = opts['max-shard-size'] ?? MaxShardSize
    const blocks = await openPail(opts.path, { maxSize: maxShardSize })
    const roots = await blocks.getRoots()
    // @ts-expect-error
    const { root, additions, removals } = await put(blocks, roots[0], key, CID.parse(value))
    await updatePail(opts.path, blocks, root, { additions, removals })

    console.log(clc.red(`--- ${roots[0]}`))
    console.log(clc.green(`+++ ${root}`))
    console.log(clc.magenta('@@ -1 +1 @@'))
    additions.forEach(b => console.log(clc.green(`+${b.cid}`)))
    removals.forEach(b => console.log(clc.red(`-${b.cid}`)))
    await closePail(blocks)
  })

cli.command('get <key>')
  .describe('Get the stored value for the given key from the pail. If the key is not found, `undefined` is returned.')
  .action(async (key, opts) => {
    const blocks = await openPail(opts.path)
    // @ts-expect-error
    const value = await get(blocks, (await blocks.getRoots())[0], key)
    if (value) console.log(value.toString())
    await closePail(blocks)
  })

cli.command('del <key>')
  .describe('Delete the value for the given key from the pail. If the key is not found no operation occurs.')
  .alias('delete', 'rm', 'remove')
  .action(async (key, opts) => {
    const blocks = await openPail(opts.path)
    const roots = await blocks.getRoots()
    // @ts-expect-error
    const { root, additions, removals } = await del(blocks, roots[0], key)
    await updatePail(opts.path, blocks, root, { additions, removals })

    console.log(clc.red(`--- ${roots[0]}`))
    console.log(clc.green(`+++ ${root}`))
    console.log(clc.magenta('@@ -1 +1 @@'))
    additions.forEach(b => console.log(clc.green(`+ ${b.cid}`)))
    removals.forEach(b => console.log(clc.red(`- ${b.cid}`)))
    await closePail(blocks)
  })

cli.command('ls')
  .describe('List entries in the pail.')
  .alias('list')
  .option('-p, --prefix', 'Key prefix to filter by.')
  .option('--json', 'Format output as newline delimted JSON.')
  .action(async (opts) => {
    const blocks = await openPail(opts.path)
    const root = (await blocks.getRoots())[0]
    let n = 0
    // @ts-expect-error
    for await (const [k, v] of entries(blocks, root, { prefix: opts.prefix })) {
      console.log(opts.json ? JSON.stringify({ key: k, value: v.toString() }) : `${k}\t${v}`)
      n++
    }
    if (!opts.json) console.log(`total ${n}`)
    await closePail(blocks)
  })

cli.command('tree')
  .describe('Visualise the pail.')
  .action(async (opts) => {
    const blocks = await openPail(opts.path)
    const root = (await blocks.getRoots())[0]
    // @ts-expect-error
    const shards = new ShardFetcher(blocks)
    // @ts-expect-error
    const rshard = await shards.get(root)

    /** @type {archy.Data} */
    const archyRoot = { label: `Shard(${clc.yellow(rshard.cid.toString())}) ${rshard.bytes.length + 'b'}`, nodes: [] }

    /** @param {API.ShardEntry} entry */
    const getData = async ([k, v]) => {
      if (!Array.isArray(v)) {
        return { label: `Key(${clc.magenta(k)})`, nodes: [{ label: `Value(${clc.cyan(v)})` }] }
      }
      /** @type {archy.Data} */
      const data = { label: `Key(${clc.magenta(k)})`, nodes: [] }
      if (v[1]) data.nodes?.push({ label: `Value(${clc.cyan(v[1])})` })
      const blk = await shards.get(v[0])
      data.nodes?.push({
        label: `Shard(${clc.yellow(v[0])}) ${blk.bytes.length + 'b'}`,
        nodes: await Promise.all(blk.value.entries.map(e => getData(e)))
      })
      return data
    }

    for (const entry of rshard.value.entries) {
      archyRoot.nodes?.push(await getData(entry))
    }

    console.log(archy(archyRoot))
    await closePail(blocks)
  })

cli.command('diff <path>')
  .describe('Find the differences between this pail and the passed pail.')
  .option('-k, --keys', 'Output key/value diff.')
  .action(async (path, opts) => {
    const [ablocks, bblocks] = await Promise.all([openPail(opts.path), openPail(path)])
    const [aroot, broot] = await Promise.all([ablocks, bblocks].map(async blocks => {
      return /** @type {API.ShardLink} */((await blocks.getRoots())[0])
    }))
    if (aroot.toString() === broot.toString()) return

    const fetcher = {
      async get (cid) {
        const blk = await ablocks.get(cid)
        if (blk) return blk
        return bblocks.get(cid)
      }
    }
    // @ts-expect-error CarReader is not BlockFetcher
    const { shards: { additions, removals }, keys } = await difference(fetcher, aroot, broot)

    console.log(clc.red(`--- ${aroot}`))
    console.log(clc.green(`+++ ${broot}`))
    console.log(clc.magenta('@@ -1 +1 @@'))

    if (opts.keys) {
      keys.forEach(([k, v]) => {
        if (v[0] != null) console.log(clc.red(`- ${k}\t${v[0]}`))
        if (v[1] != null) console.log(clc.green(`+ ${k}\t${v[1]}`))
      })
    } else {
      additions.forEach(b => console.log(clc.green(`+ ${b.cid}`)))
      removals.forEach(b => console.log(clc.red(`- ${b.cid}`)))
    }

    await Promise.all([closePail(ablocks), closePail(bblocks)])
  })

cli.command('merge <path>')
  .describe('Merge the passed pail into this pail.')
  .action(async (path, opts) => {
    const [ablocks, bblocks] = await Promise.all([openPail(opts.path), openPail(path)])
    const [aroot, broot] = await Promise.all([ablocks, bblocks].map(async blocks => {
      return /** @type {API.ShardLink} */((await blocks.getRoots())[0])
    }))
    if (aroot.toString() === broot.toString()) return

    const fetcher = {
      async get (cid) {
        const blk = await ablocks.get(cid)
        if (blk) return blk
        return bblocks.get(cid)
      }
    }
    // @ts-expect-error CarReader is not BlockFetcher
    const { root, additions, removals } = await merge(fetcher, aroot, [broot])

    await updatePail(opts.path, ablocks, root, { additions, removals })

    console.log(clc.red(`--- ${aroot}`))
    console.log(clc.green(`+++ ${root}`))
    console.log(clc.magenta('@@ -1 +1 @@'))
    additions.forEach(b => console.log(clc.green(`+ ${b.cid}`)))
    removals.forEach(b => console.log(clc.red(`- ${b.cid}`)))

    await Promise.all([closePail(ablocks), closePail(bblocks)])
  })

cli.parse(process.argv)

/**
 * @param {string} path
 * @param {{ maxSize?: number }} [config]
 * @returns {Promise<import('@ipld/car/api').CarReader>}
 */
async function openPail (path, config) {
  try {
    return await CarIndexedReader.fromFile(path)
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error('failed to open bucket', { cause: err })
    const rootblk = await ShardBlock.create(config)
    const { writer, out } = CarWriter.create(rootblk.cid)
    writer.put(rootblk)
    writer.close()
    return CarReader.fromIterable(out)
  }
}

/** @param {import('@ipld/car/api').CarReader} reader */
async function closePail (reader) {
  if (reader instanceof CarIndexedReader) {
    await reader.close()
  }
}

/**
 * @param {string} path
 * @param {import('@ipld/car/api').CarReader} reader
 * @param {API.ShardLink} root
 * @param {API.ShardDiff} diff
 */
async function updatePail (path, reader, root, { additions, removals }) {
  // @ts-expect-error
  const { writer, out } = CarWriter.create(root)
  const tmp = join(os.tmpdir(), `pail${Date.now()}.car`)

  const finishPromise = new Promise(resolve => {
    Readable.from(out).pipe(fs.createWriteStream(tmp)).on('finish', resolve)
  })

  // put new blocks
  for (const b of additions) {
    await writer.put(b)
  }
  // put old blocks without removals
  for await (const b of reader.blocks()) {
    if (removals.some(r => b.cid.toString() === r.cid.toString())) {
      continue
    }
    await writer.put(b)
  }
  await writer.close()
  await finishPromise

  const old = `${path}-${new Date().toISOString()}`
  try {
    await fs.promises.rename(path, old)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
  await fs.promises.rename(tmp, path)
  try {
    await fs.promises.rm(old)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
}
