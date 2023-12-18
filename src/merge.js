// eslint-disable-next-line no-unused-vars
import * as API from './api.js'
import { difference } from './diff.js'
import { put, del } from './index.js'

/**
 * @param {API.BlockFetcher} blocks Bucket block storage.
 * @param {API.ShardLink} base Merge base. Common parent of target DAGs.
 * @param {API.ShardLink[]} targets Target DAGs to merge.
 * @returns {Promise<{ root: API.ShardLink } & API.ShardDiff>}
 */
export async function merge (blocks, base, targets) {
  const diffs = await Promise.all(targets.map(t => difference(blocks, base, t)))
  const additions = new Map()
  const removals = new Map()
  /** @type {API.BlockFetcher} */
  const fetcher = { get: cid => additions.get(cid.toString()) ?? blocks.get(cid) }

  let root = base
  for (const { keys } of diffs) {
    for (const [k, v] of keys) {
      let res
      if (v[1] == null) {
        res = await del(fetcher, root, k)
      } else {
        res = await put(fetcher, root, k, v[1])
      }
      for (const blk of res.removals) {
        if (additions.has(blk.cid.toString())) {
          additions.delete(blk.cid.toString())
        } else {
          removals.set(blk.cid.toString(), blk)
        }
      }
      for (const blk of res.additions) {
        additions.set(blk.cid.toString(), blk)
      }
      root = res.root
    }
  }

  return { root, additions: [...additions.values()], removals: [...removals.values()] }
}
