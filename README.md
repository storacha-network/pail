# pail

[![Test](https://github.com/alanshaw/pail/actions/workflows/test.yml/badge.svg)](https://github.com/alanshaw/pail/actions/workflows/test.yml)
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

DAG based key value store. Sharded DAG that minimises traversals and work to build shards.

* 📖 [Read the SPEC](https://github.com/web3-storage/specs/blob/4163e28d7e6a7c44cff68db9d9bffb9b37707dc6/pail.md).
* 🎬 [Watch the Presentation](https://youtu.be/f-BrtpYKZfg).

## Install

```
npm install @alanshaw/pail
```

## Usage

```js
import { put, get, del } from '@alanshaw/pail'
import { ShardBlock } from '@alanshaw/pail/shard'
import { MemoryBlockstore } from '@alanshaw/pail/block'

// Initialize a new bucket
const blocks = new MemoryBlockstore()
const init = await ShardBlock.create() // empty root shard
await blocks.put(init.cid, init.bytes)

// Add a key and value to the bucket
const { root, additions, removals } = await put(blocks, init.cid, 'path/to/data0', dataCID0)

console.log(`new root: ${root}`)

// Process the diff
for (const block of additions) {
  await blocks.put(block.cid, block.bytes)
}
for (const block of removals) {
  await blocks.delete(block.cid)
}
```

### Batch operations

If adding many multiple items to the pail together, it is faster to batch them together.

```js
import { put, get, del } from '@alanshaw/pail'
import { ShardBlock } from '@alanshaw/pail/shard'
import { MemoryBlockstore } from '@alanshaw/pail/block'
import * as Batcher from '@alanshaw/pail/batch'

// Initialize a new bucket
const blocks = new MemoryBlockstore()
const init = await ShardBlock.create() // empty root shard
await blocks.put(init.cid, init.bytes)

const batch = await Batcher.create(blocks, init.cid)

// items is an array of `{ key: string, value: CID }` - the items to add to the pail
for (const item of items) {
  await batch.put(item.key, item.value)
}

const { root, additions, removals } = await batch.commit()

console.log(`new root: ${root}`)

// Process the diff
for (const block of additions) {
  await blocks.put(block.cid, block.bytes)
}
for (const block of removals) {
  await blocks.delete(block.cid)
}
```

## Contributing

Feel free to join in. All welcome. [Open an issue](https://github.com/alanshaw/pail/issues)!

## License

Dual-licensed under [MIT or Apache 2.0](https://github.com/alanshaw/pail/blob/main/LICENSE.md)
