import { Link, UnknownLink, BlockView, Block, Version } from 'multiformats'
import { sha256 } from 'multiformats/hashes/sha2'
import * as dagCBOR from '@ipld/dag-cbor'

export { Link, UnknownLink, BlockView, Block, Version }

export type ShardEntryValueValue = UnknownLink

export type ShardEntryLinkValue = [ShardLink]

export type ShardEntryLinkAndValueValue = [ShardLink, UnknownLink]

export type ShardValueEntry = [key: string, value: ShardEntryValueValue]

export type ShardLinkEntry = [key: string, value: ShardEntryLinkValue | ShardEntryLinkAndValueValue]

/** Single key/value entry within a shard. */
export type ShardEntry = [key: string, value: ShardEntryValueValue | ShardEntryLinkValue | ShardEntryLinkAndValueValue]

export interface Shard extends ShardConfig {
  entries: ShardEntry[]
}

export type ShardLink = Link<Shard, typeof dagCBOR.code, typeof sha256.code, 1>

export interface ShardBlockView extends BlockView<Shard, typeof dagCBOR.code, typeof sha256.code, 1> {}

export interface ShardDiff {
  additions: ShardBlockView[]
  removals: ShardBlockView[]
}

export interface BlockFetcher {
  get<T = unknown, C extends number = number, A extends number = number, V extends Version = 1> (link: Link<T, C, A, V>):
    Promise<Block<T, C, A, V> | undefined>
}

export interface ShardConfig {
  /** Shard compatibility version. */
  version: number
  /**
   * Characters allowed in keys. If a string, it refers to a known character
   * set. e.g. "ascii" refers to the printable ASCII characters in the code
   * range 32-126.
   */
  keyChars: string
  /** Max key size in bytes - default 4096 bytes. */
  maxKeySize: number
  /** The key prefix from the root to this shard. */
  prefix: string
}

export type ShardOptions = Partial<ShardConfig>
