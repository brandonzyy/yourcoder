import { spawn, type ChildProcessWithoutNullStreams } from "child_process"
import path from "path"
import os from "os"
import { Global } from "../../util/global"
import { Log } from "../../util/log"
import { BunProc } from "../../util/bun"
import { $ } from "bun"
import { text } from "node:stream/consumers"
import fs from "fs/promises"
import { Filesystem } from "../../util/filesystem"
import { Instance } from "../../project/instance"
import { Flag } from "../../config/flag"
import { Archive } from "../../util/archive"
import { Process } from "../../util/process"
import { which } from "../../util/which"

export { $, Archive, BunProc, Filesystem, Flag, fs, Global, Instance, os, path, Process, spawn, text, which }

export const log = Log.create({ service: "lsp.server" })

export const pathExists = async (p: string) =>
  fs
    .stat(p)
    .then(() => true)
    .catch(() => false)

export interface Handle {
  process: ChildProcessWithoutNullStreams
  initialization?: Record<string, any>
}

export type RootFunction = (file: string) => Promise<string | undefined>

export const NearestRoot = (includePatterns: string[], excludePatterns?: string[]): RootFunction => {
  return async (file) => {
    if (excludePatterns) {
      const excludedFiles = Filesystem.up({
        targets: excludePatterns,
        start: path.dirname(file),
        stop: Instance.directory,
      })
      const excluded = await excludedFiles.next()
      await excludedFiles.return()
      if (excluded.value) return undefined
    }
    const files = Filesystem.up({
      targets: includePatterns,
      start: path.dirname(file),
      stop: Instance.directory,
    })
    const first = await files.next()
    await files.return()
    if (!first.value) return Instance.directory
    return path.dirname(first.value)
  }
}

export interface Info {
  id: string
  extensions: string[]
  global?: boolean
  root: RootFunction
  spawn(root: string): Promise<Handle | undefined>
}
