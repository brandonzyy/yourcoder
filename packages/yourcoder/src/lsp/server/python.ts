import { BunProc, Filesystem, Flag, Global, log, NearestRoot, path, Process, spawn, type Info, which } from "./shared"

export const Rubocop: Info = {
  id: "ruby-lsp",
  root: NearestRoot(["Gemfile"]),
  extensions: [".rb", ".rake", ".gemspec", ".ru"],
  async spawn(root) {
    let bin = which("rubocop", {
      PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
    })
    if (!bin) {
      const ruby = which("ruby")
      const gem = which("gem")
      if (!ruby || !gem) {
        log.info("Ruby not found, please install Ruby first")
        return
      }
      if (Flag.YC_DISABLE_LSP_DOWNLOAD) return
      log.info("installing rubocop")
      const proc = Process.spawn(["gem", "install", "rubocop", "--bindir", Global.Path.bin], {
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      })
      const exit = await proc.exited
      if (exit !== 0) {
        log.error("Failed to install rubocop")
        return
      }
      bin = path.join(Global.Path.bin, "rubocop" + (process.platform === "win32" ? ".exe" : ""))
      log.info(`installed rubocop`, {
        bin,
      })
    }
    return {
      process: spawn(bin!, ["--lsp"], {
        cwd: root,
      }),
    }
  },
}

export const Ty: Info = {
  id: "ty",
  extensions: [".py", ".pyi"],
  root: NearestRoot([
    "pyproject.toml",
    "ty.toml",
    "setup.py",
    "setup.cfg",
    "requirements.txt",
    "Pipfile",
    "pyrightconfig.json",
  ]),
  async spawn(root) {
    if (!Flag.YC_EXPERIMENTAL_LSP_TY) {
      return undefined
    }

    let binary = which("ty")

    const initialization: Record<string, string> = {}

    const potentialVenvPaths = [process.env["VIRTUAL_ENV"], path.join(root, ".venv"), path.join(root, "venv")].filter(
      (p): p is string => p !== undefined,
    )
    for (const venvPath of potentialVenvPaths) {
      const isWindows = process.platform === "win32"
      const potentialPythonPath = isWindows
        ? path.join(venvPath, "Scripts", "python.exe")
        : path.join(venvPath, "bin", "python")
      if (await Filesystem.exists(potentialPythonPath)) {
        initialization["pythonPath"] = potentialPythonPath
        break
      }
    }

    if (!binary) {
      for (const venvPath of potentialVenvPaths) {
        const isWindows = process.platform === "win32"
        const potentialTyPath = isWindows ? path.join(venvPath, "Scripts", "ty.exe") : path.join(venvPath, "bin", "ty")
        if (await Filesystem.exists(potentialTyPath)) {
          binary = potentialTyPath
          break
        }
      }
    }

    if (!binary) {
      log.error("ty not found, please install ty first")
      return
    }

    const proc = spawn(binary, ["server"], {
      cwd: root,
    })

    return {
      process: proc,
      initialization,
    }
  },
}

export const Pyright: Info = {
  id: "pyright",
  extensions: [".py", ".pyi"],
  root: NearestRoot(["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile", "pyrightconfig.json"]),
  async spawn(root) {
    let binary = which("pyright-langserver")
    const args = []
    if (!binary) {
      const js = path.join(Global.Path.bin, "node_modules", "pyright", "dist", "pyright-langserver.js")
      if (!(await Filesystem.exists(js))) {
        if (Flag.YC_DISABLE_LSP_DOWNLOAD) return
        await Process.spawn([BunProc.which(), "install", "pyright"], {
          cwd: Global.Path.bin,
          env: {
            ...process.env,
            BUN_BE_BUN: "1",
          },
        }).exited
      }
      binary = BunProc.which()
      args.push(...["run", js])
    }
    args.push("--stdio")

    const initialization: Record<string, string> = {}

    const potentialVenvPaths = [process.env["VIRTUAL_ENV"], path.join(root, ".venv"), path.join(root, "venv")].filter(
      (p): p is string => p !== undefined,
    )
    for (const venvPath of potentialVenvPaths) {
      const isWindows = process.platform === "win32"
      const potentialPythonPath = isWindows
        ? path.join(venvPath, "Scripts", "python.exe")
        : path.join(venvPath, "bin", "python")
      if (await Filesystem.exists(potentialPythonPath)) {
        initialization["pythonPath"] = potentialPythonPath
        break
      }
    }

    const proc = spawn(binary, args, {
      cwd: root,
      env: {
        ...process.env,
        BUN_BE_BUN: "1",
      },
    })
    return {
      process: proc,
      initialization,
    }
  },
}
