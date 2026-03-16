import {
  $,
  Archive,
  BunProc,
  Filesystem,
  Flag,
  fs,
  Global,
  Instance,
  log,
  NearestRoot,
  path,
  Process,
  spawn,
  type Info,
  which,
} from "./shared"

export const YamlLS: Info = {
  id: "yaml-ls",
  extensions: [".yaml", ".yml"],
  root: NearestRoot(["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"]),
  async spawn(root) {
    let binary = which("yaml-language-server")
    const args: string[] = []
    if (!binary) {
      const js = path.join(Global.Path.bin, "node_modules", "yaml-language-server", "out", "server", "src", "server.js")
      const exists = await Filesystem.exists(js)
      if (!exists) {
        if (Flag.YC_DISABLE_LSP_DOWNLOAD) return
        await Process.spawn([BunProc.which(), "install", "yaml-language-server"], {
          cwd: Global.Path.bin,
          env: {
            ...process.env,
            BUN_BE_BUN: "1",
          },
          stdout: "pipe",
          stderr: "pipe",
          stdin: "pipe",
        }).exited
      }
      binary = BunProc.which()
      args.push("run", js)
    }
    args.push("--stdio")
    const proc = spawn(binary, args, {
      cwd: root,
      env: {
        ...process.env,
        BUN_BE_BUN: "1",
      },
    })
    return {
      process: proc,
    }
  },
}

export const LuaLS: Info = {
  id: "lua-ls",
  root: NearestRoot([
    ".luarc.json",
    ".luarc.jsonc",
    ".luacheckrc",
    ".stylua.toml",
    "stylua.toml",
    "selene.toml",
    "selene.yml",
  ]),
  extensions: [".lua"],
  async spawn(root) {
    let bin = which("lua-language-server", {
      PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
    })

    if (!bin) {
      if (Flag.YC_DISABLE_LSP_DOWNLOAD) return
      log.info("downloading lua-language-server from GitHub releases")

      const releaseResponse = await fetch("https://api.github.com/repos/LuaLS/lua-language-server/releases/latest")
      if (!releaseResponse.ok) {
        log.error("Failed to fetch lua-language-server release info")
        return
      }

      const release = await releaseResponse.json()

      const platform = process.platform
      const arch = process.arch
      let assetName = ""

      let lualsArch: string = arch
      if (arch === "arm64") lualsArch = "arm64"
      else if (arch === "x64") lualsArch = "x64"
      else if (arch === "ia32") lualsArch = "ia32"

      let lualsPlatform: string = platform
      if (platform === "darwin") lualsPlatform = "darwin"
      else if (platform === "linux") lualsPlatform = "linux"
      else if (platform === "win32") lualsPlatform = "win32"

      const ext = platform === "win32" ? "zip" : "tar.gz"

      assetName = `lua-language-server-${release.tag_name}-${lualsPlatform}-${lualsArch}.${ext}`

      const supportedCombos = [
        "darwin-arm64.tar.gz",
        "darwin-x64.tar.gz",
        "linux-x64.tar.gz",
        "linux-arm64.tar.gz",
        "win32-x64.zip",
        "win32-ia32.zip",
      ]

      const assetSuffix = `${lualsPlatform}-${lualsArch}.${ext}`
      if (!supportedCombos.includes(assetSuffix)) {
        log.error(`Platform ${platform} and architecture ${arch} is not supported by lua-language-server`)
        return
      }

      const asset = release.assets.find((a: any) => a.name === assetName)
      if (!asset) {
        log.error(`Could not find asset ${assetName} in latest lua-language-server release`)
        return
      }

      const downloadUrl = asset.browser_download_url
      const downloadResponse = await fetch(downloadUrl)
      if (!downloadResponse.ok) {
        log.error("Failed to download lua-language-server")
        return
      }

      const tempPath = path.join(Global.Path.bin, assetName)
      if (downloadResponse.body) await Filesystem.writeStream(tempPath, downloadResponse.body)

      // Unlike zls which is a single self-contained binary,
      // lua-language-server needs supporting files (meta/, locale/, etc.)
      // Extract entire archive to dedicated directory to preserve all files
      const installDir = path.join(Global.Path.bin, `lua-language-server-${lualsArch}-${lualsPlatform}`)

      // Remove old installation if exists
      const stats = await fs.stat(installDir).catch(() => undefined)
      if (stats) {
        await fs.rm(installDir, { force: true, recursive: true })
      }

      await fs.mkdir(installDir, { recursive: true })

      if (ext === "zip") {
        const ok = await Archive.extractZip(tempPath, installDir)
          .then(() => true)
          .catch((error) => {
            log.error("Failed to extract lua-language-server archive", { error })
            return false
          })
        if (!ok) return
      } else {
        const ok = await $`tar -xzf ${tempPath} -C ${installDir}`
          .quiet()
          .then(() => true)
          .catch((error) => {
            log.error("Failed to extract lua-language-server archive", { error })
            return false
          })
        if (!ok) return
      }

      await fs.rm(tempPath, { force: true })

      // Binary is located in bin/ subdirectory within the extracted archive
      bin = path.join(installDir, "bin", "lua-language-server" + (platform === "win32" ? ".exe" : ""))

      if (!(await Filesystem.exists(bin))) {
        log.error("Failed to extract lua-language-server binary")
        return
      }

      if (platform !== "win32") {
        const ok = await $`chmod +x ${bin}`.quiet().catch((error) => {
          log.error("Failed to set executable permission for lua-language-server binary", {
            error,
          })
        })
        if (!ok) return
      }

      log.info(`installed lua-language-server`, { bin })
    }

    return {
      process: spawn(bin, {
        cwd: root,
      }),
    }
  },
}

export const PHPIntelephense: Info = {
  id: "php intelephense",
  extensions: [".php"],
  root: NearestRoot(["composer.json", "composer.lock", ".php-version"]),
  async spawn(root) {
    let binary = which("intelephense")
    const args: string[] = []
    if (!binary) {
      const js = path.join(Global.Path.bin, "node_modules", "intelephense", "lib", "intelephense.js")
      if (!(await Filesystem.exists(js))) {
        if (Flag.YC_DISABLE_LSP_DOWNLOAD) return
        await Process.spawn([BunProc.which(), "install", "intelephense"], {
          cwd: Global.Path.bin,
          env: {
            ...process.env,
            BUN_BE_BUN: "1",
          },
          stdout: "pipe",
          stderr: "pipe",
          stdin: "pipe",
        }).exited
      }
      binary = BunProc.which()
      args.push("run", js)
    }
    args.push("--stdio")
    const proc = spawn(binary, args, {
      cwd: root,
      env: {
        ...process.env,
        BUN_BE_BUN: "1",
      },
    })
    return {
      process: proc,
      initialization: {
        telemetry: {
          enabled: false,
        },
      },
    }
  },
}

export const Prisma: Info = {
  id: "prisma",
  extensions: [".prisma"],
  root: NearestRoot(["schema.prisma", "prisma/schema.prisma", "prisma"], ["package.json"]),
  async spawn(root) {
    const prisma = which("prisma")
    if (!prisma) {
      log.info("prisma not found, please install prisma")
      return
    }
    return {
      process: spawn(prisma, ["language-server"], {
        cwd: root,
      }),
    }
  },
}

export const Dart: Info = {
  id: "dart",
  extensions: [".dart"],
  root: NearestRoot(["pubspec.yaml", "analysis_options.yaml"]),
  async spawn(root) {
    const dart = which("dart")
    if (!dart) {
      log.info("dart not found, please install dart first")
      return
    }
    return {
      process: spawn(dart, ["language-server", "--lsp"], {
        cwd: root,
      }),
    }
  },
}

export const Ocaml: Info = {
  id: "ocaml-lsp",
  extensions: [".ml", ".mli"],
  root: NearestRoot(["dune-project", "dune-workspace", ".merlin", "opam"]),
  async spawn(root) {
    const bin = which("ocamllsp")
    if (!bin) {
      log.info("ocamllsp not found, please install ocaml-lsp-server")
      return
    }
    return {
      process: spawn(bin, {
        cwd: root,
      }),
    }
  },
}
export const BashLS: Info = {
  id: "bash",
  extensions: [".sh", ".bash", ".zsh", ".ksh"],
  root: async () => Instance.directory,
  async spawn(root) {
    let binary = which("bash-language-server")
    const args: string[] = []
    if (!binary) {
      const js = path.join(Global.Path.bin, "node_modules", "bash-language-server", "out", "cli.js")
      if (!(await Filesystem.exists(js))) {
        if (Flag.YC_DISABLE_LSP_DOWNLOAD) return
        await Process.spawn([BunProc.which(), "install", "bash-language-server"], {
          cwd: Global.Path.bin,
          env: {
            ...process.env,
            BUN_BE_BUN: "1",
          },
          stdout: "pipe",
          stderr: "pipe",
          stdin: "pipe",
        }).exited
      }
      binary = BunProc.which()
      args.push("run", js)
    }
    args.push("start")
    const proc = spawn(binary, args, {
      cwd: root,
      env: {
        ...process.env,
        BUN_BE_BUN: "1",
      },
    })
    return {
      process: proc,
    }
  },
}

export const DockerfileLS: Info = {
  id: "dockerfile",
  extensions: [".dockerfile", "Dockerfile"],
  root: async () => Instance.directory,
  async spawn(root) {
    let binary = which("docker-langserver")
    const args: string[] = []
    if (!binary) {
      const js = path.join(Global.Path.bin, "node_modules", "dockerfile-language-server-nodejs", "lib", "server.js")
      if (!(await Filesystem.exists(js))) {
        if (Flag.YC_DISABLE_LSP_DOWNLOAD) return
        await Process.spawn([BunProc.which(), "install", "dockerfile-language-server-nodejs"], {
          cwd: Global.Path.bin,
          env: {
            ...process.env,
            BUN_BE_BUN: "1",
          },
          stdout: "pipe",
          stderr: "pipe",
          stdin: "pipe",
        }).exited
      }
      binary = BunProc.which()
      args.push("run", js)
    }
    args.push("--stdio")
    const proc = spawn(binary, args, {
      cwd: root,
      env: {
        ...process.env,
        BUN_BE_BUN: "1",
      },
    })
    return {
      process: proc,
    }
  },
}

export const Gleam: Info = {
  id: "gleam",
  extensions: [".gleam"],
  root: NearestRoot(["gleam.toml"]),
  async spawn(root) {
    const gleam = which("gleam")
    if (!gleam) {
      log.info("gleam not found, please install gleam first")
      return
    }
    return {
      process: spawn(gleam, ["lsp"], {
        cwd: root,
      }),
    }
  },
}

export const Clojure: Info = {
  id: "clojure-lsp",
  extensions: [".clj", ".cljs", ".cljc", ".edn"],
  root: NearestRoot(["deps.edn", "project.clj", "shadow-cljs.edn", "bb.edn", "build.boot"]),
  async spawn(root) {
    let bin = which("clojure-lsp")
    if (!bin && process.platform === "win32") {
      bin = which("clojure-lsp.exe")
    }
    if (!bin) {
      log.info("clojure-lsp not found, please install clojure-lsp first")
      return
    }
    return {
      process: spawn(bin, ["listen"], {
        cwd: root,
      }),
    }
  },
}

export const Nixd: Info = {
  id: "nixd",
  extensions: [".nix"],
  root: async (file) => {
    // First, look for flake.nix - the most reliable Nix project root indicator
    const flakeRoot = await NearestRoot(["flake.nix"])(file)
    if (flakeRoot && flakeRoot !== Instance.directory) return flakeRoot

    // If no flake.nix, fall back to git repository root
    if (Instance.worktree && Instance.worktree !== Instance.directory) return Instance.worktree

    // Finally, use the instance directory as fallback
    return Instance.directory
  },
  async spawn(root) {
    const nixd = which("nixd")
    if (!nixd) {
      log.info("nixd not found, please install nixd first")
      return
    }
    return {
      process: spawn(nixd, [], {
        cwd: root,
        env: {
          ...process.env,
        },
      }),
    }
  },
}
