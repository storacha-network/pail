import {
  ShardFetcher,
  ShardBlock,
  encodeShardBlock,
  decodeShardBlock,
  putEntry,
  findCommonPrefix
} from './shard.js'

export { ShardBlock, encodeShardBlock, decodeShardBlock }

/**
 * @typedef {{ additions: import('./shard').ShardBlockView[], removals: import('./shard').ShardBlockView[] }} ShardDiff
 */

export const MaxKeyLength = 64
export const MaxShardSize = 512 * 1024

/**
 * Put a value (a CID) for the given key. If the key exists it's value is
 * overwritten.
 *
 * @param {import('./block').BlockFetcher} blocks Bucket block storage.
 * @param {import('./shard').ShardLink} root CID of the root node of the bucket.
 * @param {string} key The key of the value to put.
 * @param {import('./link').AnyLink} value The value to put.
 * @param {object} [options]
 * @param {number} [options.maxShardSize] Maximum shard size in bytes.
 * @returns {Promise<{ root: import('./shard').ShardLink } & ShardDiff>}
 */
export async function put (blocks, root, key, value, options = {}) {
  const shards = new ShardFetcher(blocks)
  const rshard = await shards.get(root)
  const path = await traverse(shards, rshard, key)
  const target = path[path.length - 1]
  const skey = key.slice(target.prefix.length) // key within the shard

  /** @type {import('./shard').ShardEntry} */
  let entry = [skey, value]

  /** @type {import('./shard').ShardBlockView[]} */
  const additions = []

  // if the key in this shard is longer than allowed, then we need to make some
  // intermediate shards.
  if (skey.length > MaxKeyLength) {
    const pfxskeys = Array.from(Array(Math.ceil(skey.length / MaxKeyLength)), (_, i) => {
      const start = i * MaxKeyLength
      return {
        prefix: target.prefix + skey.slice(0, start),
        skey: skey.slice(start, start + MaxKeyLength)
      }
    })

    let child = await encodeShardBlock([[pfxskeys[pfxskeys.length - 1].skey, value]], pfxskeys[pfxskeys.length - 1].prefix)
    additions.push(child)

    for (let i = pfxskeys.length - 2; i > 0; i--) {
      child = await encodeShardBlock([[pfxskeys[i].skey, [child.cid]]], pfxskeys[i].prefix)
      additions.push(child)
    }

    entry = [pfxskeys[0].skey, [child.cid]]
  }

  /** @type {import('./shard').Shard} */
  let shard = putEntry(target.value, entry)
  let child = await encodeShardBlock(shard, target.prefix)

  if (child.bytes.length > (options.maxShardSize ?? MaxShardSize)) {
    const common = findCommonPrefix(shard, entry[0])
    if (!common) throw new Error('shard limit reached')
    const { prefix, matches } = common
    const block = await encodeShardBlock(
      matches.filter(([k]) => k !== prefix).map(([k, v]) => [k.slice(prefix.length), v]),
      target.prefix + prefix
    )
    additions.push(block)

    /** @type {import('./shard').ShardEntryLinkValue | import('./shard').ShardEntryLinkAndValueValue} */
    let value
    const pfxmatch = matches.find(([k]) => k === prefix)
    if (pfxmatch) {
      if (Array.isArray(pfxmatch[1])) {
        // should not happen! all entries with this prefix should have been
        // placed within this shard already.
        throw new Error(`expected "${prefix}" to be a shard value but found a shard link`)
      }
      value = [block.cid, pfxmatch[1]]
    } else {
      value = [block.cid]
    }

    shard = shard.filter(e => matches.every(m => e[0] !== m[0]))
    shard = putEntry(shard, [prefix, value])
    child = await encodeShardBlock(shard, target.prefix)
  }

  // if no change in the target then we're done
  if (child.cid.toString() === target.cid.toString()) {
    return { root, additions: [], removals: [] }
  }

  additions.push(child)

  // path is root -> shard, so work backwards, propagating the new shard CID
  for (let i = path.length - 2; i >= 0; i--) {
    const parent = path[i]
    const key = child.prefix.slice(parent.prefix.length)
    const value = parent.value.map((entry) => {
      const [k, v] = entry
      if (k !== key) return entry
      if (!Array.isArray(v)) throw new Error(`"${key}" is not a shard link in: ${parent.cid}`)
      return /** @type {import('./shard').ShardEntry} */(v[1] == null ? [k, [child.cid]] : [k, [child.cid, v[1]]])
    })

    child = await encodeShardBlock(value, parent.prefix)
    additions.push(child)
  }

  return { root: additions[additions.length - 1].cid, additions, removals: path }
}

/**
 * Get the stored value for the given key from the bucket. If the key is not
 * found, `undefined` is returned.
 *
 * @param {import('./block').BlockFetcher} blocks Bucket block storage.
 * @param {import('./shard').ShardLink} root CID of the root node of the bucket.
 * @param {string} key The key of the value to get.
 * @returns {Promise<import('./link').AnyLink | undefined>}
 */
export async function get (blocks, root, key) {
  const shards = new ShardFetcher(blocks)
  const rshard = await shards.get(root)
  const path = await traverse(shards, rshard, key)
  const target = path[path.length - 1]
  const skey = key.slice(target.prefix.length) // key within the shard
  const entry = target.value.find(([k]) => k === skey)
  if (!entry) return
  return Array.isArray(entry[1]) ? entry[1][1] : entry[1]
}

/**
 * Delete the value for the given key from the bucket. If the key is not found
 * no operation occurs.
 *
 * @param {import('./block').BlockFetcher} blocks Bucket block storage.
 * @param {import('./shard').ShardLink} root CID of the root node of the bucket.
 * @param {string} key The key of the value to delete.
 * @returns {Promise<{ root: import('./shard').ShardLink } & ShardDiff>}
 */
export async function del (blocks, root, key) {
  const shards = new ShardFetcher(blocks)
  const rshard = await shards.get(root)
  const path = await traverse(shards, rshard, key)
  const target = path[path.length - 1]
  const skey = key.slice(target.prefix.length) // key within the shard

  const entryidx = target.value.findIndex(([k]) => k === skey)
  if (entryidx === -1) return { root, additions: [], removals: [] }

  const entry = target.value[entryidx]
  // cannot delete a shard (without data)
  if (Array.isArray(entry[1]) && entry[1][1] == null) return { root, additions: [], removals: [] }

  /** @type {import('./shard').ShardBlockView[]} */
  const additions = []
  /** @type {import('./shard').ShardBlockView[]} */
  const removals = [...path]

  let shard = [...target.value]

  if (Array.isArray(entry[1])) {
    // remove the value from this link+value
    shard[entryidx] = [entry[0], [entry[1][0]]]
  } else {
    shard.splice(entryidx, 1)
    // if now empty, remove from parent
    while (!shard.length) {
      const child = path[path.length - 1]
      const parent = path[path.length - 2]
      if (!parent) break
      path.pop()
      shard = parent.value.filter(e => {
        if (!Array.isArray(e[1])) return true
        return e[1][0].toString() !== child.cid.toString()
      })
    }
  }

  let child = await encodeShardBlock(shard, path[path.length - 1].prefix)
  additions.push(child)

  // path is root -> shard, so work backwards, propagating the new shard CID
  for (let i = path.length - 2; i >= 0; i--) {
    const parent = path[i]
    const key = child.prefix.slice(parent.prefix.length)
    const value = parent.value.map((entry) => {
      const [k, v] = entry
      if (k !== key) return entry
      if (!Array.isArray(v)) throw new Error(`"${key}" is not a shard link in: ${parent.cid}`)
      return /** @type {import('./shard').ShardEntry} */(v[1] == null ? [k, [child.cid]] : [k, [child.cid, v[1]]])
    })

    child = await encodeShardBlock(value, parent.prefix)
    additions.push(child)
  }

  return { root: additions[additions.length - 1].cid, additions, removals }
}

/**
 * List entries in the bucket.
 *
 * @param {import('./block').BlockFetcher} blocks Bucket block storage.
 * @param {import('./shard').ShardLink} root CID of the root node of the bucket.
 * @param {object} [options]
 * @param {string} [options.prefix]
 * @returns {AsyncIterableIterator<import('./shard').ShardValueEntry>}
 */
export async function * entries (blocks, root, options = {}) {
  const { prefix } = options
  const shards = new ShardFetcher(blocks)
  const rshard = await shards.get(root)

  yield * (
    /** @returns {AsyncIterableIterator<import('./shard').ShardValueEntry>} */
    async function * ents (shard) {
      for (const entry of shard.value) {
        const key = shard.prefix + entry[0]

        if (Array.isArray(entry[1])) {
          if (entry[1][1]) {
            if (!prefix || (prefix && key.startsWith(prefix))) {
              yield [key, entry[1][1]]
            }
          }

          if (prefix) {
            if (prefix.length <= key.length && !key.startsWith(prefix)) {
              continue
            }
            if (prefix.length > key.length && !prefix.startsWith(key)) {
              continue
            }
          }
          yield * ents(await shards.get(entry[1][0], key))
        } else {
          if (prefix && !key.startsWith(prefix)) {
            continue
          }
          yield [key, entry[1]]
        }
      }
    }
  )(rshard)
}

/**
 * Traverse from the passed shard block to the target shard block using the
 * passed key. All traversed shards are returned, starting with the passed
 * shard and ending with the target.
 *
 * @param {ShardFetcher} shards
 * @param {import('./shard').ShardBlockView} shard
 * @param {string} key
 * @returns {Promise<[import('./shard').ShardBlockView, ...Array<import('./shard').ShardBlockView>]>}
 */
async function traverse (shards, shard, key) {
  for (const [k, v] of shard.value) {
    if (key === k) return [shard]
    if (key.startsWith(k) && Array.isArray(v)) {
      const path = await traverse(shards, await shards.get(v[0], shard.prefix + k), key.slice(k.length))
      return [shard, ...path]
    }
  }
  return [shard]
}
