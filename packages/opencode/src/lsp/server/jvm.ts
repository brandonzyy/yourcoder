import {
  $,
  Archive,
  Filesystem,
  Flag,
  fs,
  Global,
  log,
  NearestRoot,
  os,
  path,
  pathExists,
  Process,
  spawn,
  type Info,
  which,
} from "./shared"

export const ElixirLS: Info = {
  id: "elixir-ls",
  extensions: [".ex", ".exs"],
  root: NearestRoot(["mix.exs", "mix.lock"]),
  async spawn(root) {
    let binary = which("elixir-ls")
    if (!binary) {
      const elixirLsPath = path.join(Global.Path.bin, "elixir-ls")
      binary = path.join(
        Global.Path.bin,
        "elixir-ls-master",
        "release",
        process.platform === "win32" ? "language_server.bat" : "language_server.sh",
      )

      if (!(await Filesystem.exists(binary))) {
        const elixir = which("elixir")
        if (!elixir) {
          log.error("elixir is required to run elixir-ls")
          return
        }

        if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
        log.info("downloading elixir-ls from GitHub releases")

        const response = await fetch("https://github.com/elixir-lsp/elixir-ls/archive/refs/heads/master.zip")
        if (!response.ok) return
        const zipPath = path.join(Global.Path.bin, "elixir-ls.zip")
        if (response.body) await Filesystem.writeStream(zipPath, response.body)

        const ok = await Archive.extractZip(zipPath, Global.Path.bin)
          .then(() => true)
          .catch((error) => {
            log.error("Failed to extract elixir-ls archive", { error })
            return false
          })
        if (!ok) return

        await fs.rm(zipPath, {
          force: true,
          recursive: true,
        })

        await $`mix deps.get && mix compile && mix elixir_ls.release2 -o release`
          .quiet()
          .cwd(path.join(Global.Path.bin, "elixir-ls-master"))
          .env({ MIX_ENV: "prod", ...process.env })

        log.info(`installed elixir-ls`, {
          path: elixirLsPath,
        })
      }
    }

    return {
      process: spawn(binary, {
        cwd: root,
      }),
    }
  },
}

export const JDTLS: Info = {
  id: "jdtls",
  root: NearestRoot(["pom.xml", "build.gradle", "build.gradle.kts", ".project", ".classpath"]),
  extensions: [".java"],
  async spawn(root) {
    const java = which("java")
    if (!java) {
      log.error("Java 21 or newer is required to run the JDTLS. Please install it first.")
      return
    }
    const javaMajorVersion = await $`java -version`
      .quiet()
      .nothrow()
      .then(({ stderr }) => {
        const m = /"(\d+)\.\d+\.\d+"/.exec(stderr.toString())
        return !m ? undefined : parseInt(m[1])
      })
    if (javaMajorVersion == null || javaMajorVersion < 21) {
      log.error("JDTLS requires at least Java 21.")
      return
    }
    const distPath = path.join(Global.Path.bin, "jdtls")
    const launcherDir = path.join(distPath, "plugins")
    const installed = await pathExists(launcherDir)
    if (!installed) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      log.info("Downloading JDTLS LSP server.")
      await fs.mkdir(distPath, { recursive: true })
      const releaseURL =
        "https://www.eclipse.org/downloads/download.php?file=/jdtls/snapshots/jdt-language-server-latest.tar.gz"
      const archiveName = "release.tar.gz"

      log.info("Downloading JDTLS archive", { url: releaseURL, dest: distPath })
      const curlResult = await $`curl -L -o ${archiveName} '${releaseURL}'`.cwd(distPath).quiet().nothrow()
      if (curlResult.exitCode !== 0) {
        log.error("Failed to download JDTLS", { exitCode: curlResult.exitCode, stderr: curlResult.stderr.toString() })
        return
      }

      log.info("Extracting JDTLS archive")
      const tarResult = await $`tar -xzf ${archiveName}`.cwd(distPath).quiet().nothrow()
      if (tarResult.exitCode !== 0) {
        log.error("Failed to extract JDTLS", { exitCode: tarResult.exitCode, stderr: tarResult.stderr.toString() })
        return
      }

      await fs.rm(path.join(distPath, archiveName), { force: true })
      log.info("JDTLS download and extraction completed")
    }
    const jarFileName = await $`ls org.eclipse.equinox.launcher_*.jar`
      .cwd(launcherDir)
      .quiet()
      .nothrow()
      .then(({ stdout }) => stdout.toString().trim())
    const launcherJar = path.join(launcherDir, jarFileName)
    if (!(await pathExists(launcherJar))) {
      log.error(`Failed to locate the JDTLS launcher module in the installed directory: ${distPath}.`)
      return
    }
    const configFile = path.join(
      distPath,
      (() => {
        switch (process.platform) {
          case "darwin":
            return "config_mac"
          case "linux":
            return "config_linux"
          case "win32":
            return "config_win"
          default:
            return "config_linux"
        }
      })(),
    )
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-jdtls-data"))
    return {
      process: spawn(
        java,
        [
          "-jar",
          launcherJar,
          "-configuration",
          configFile,
          "-data",
          dataDir,
          "-Declipse.application=org.eclipse.jdt.ls.core.id1",
          "-Dosgi.bundles.defaultStartLevel=4",
          "-Declipse.product=org.eclipse.jdt.ls.core.product",
          "-Dlog.level=ALL",
          "--add-modules=ALL-SYSTEM",
          "--add-opens java.base/java.util=ALL-UNNAMED",
          "--add-opens java.base/java.lang=ALL-UNNAMED",
        ],
        {
          cwd: root,
        },
      ),
    }
  },
}

export const KotlinLS: Info = {
  id: "kotlin-ls",
  extensions: [".kt", ".kts"],
  root: async (file) => {
    // 1) Nearest Gradle root (multi-project or included build)
    const settingsRoot = await NearestRoot(["settings.gradle.kts", "settings.gradle"])(file)
    if (settingsRoot) return settingsRoot
    // 2) Gradle wrapper (strong root signal)
    const wrapperRoot = await NearestRoot(["gradlew", "gradlew.bat"])(file)
    if (wrapperRoot) return wrapperRoot
    // 3) Single-project or module-level build
    const buildRoot = await NearestRoot(["build.gradle.kts", "build.gradle"])(file)
    if (buildRoot) return buildRoot
    // 4) Maven fallback
    return NearestRoot(["pom.xml"])(file)
  },
  async spawn(root) {
    const distPath = path.join(Global.Path.bin, "kotlin-ls")
    const launcherScript =
      process.platform === "win32" ? path.join(distPath, "kotlin-lsp.cmd") : path.join(distPath, "kotlin-lsp.sh")
    const installed = await Filesystem.exists(launcherScript)
    if (!installed) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      log.info("Downloading Kotlin Language Server from GitHub.")

      const releaseResponse = await fetch("https://api.github.com/repos/Kotlin/kotlin-lsp/releases/latest")
      if (!releaseResponse.ok) {
        log.error("Failed to fetch kotlin-lsp release info")
        return
      }

      const release = await releaseResponse.json()
      const version = release.name?.replace(/^v/, "")

      if (!version) {
        log.error("Could not determine Kotlin LSP version from release")
        return
      }

      const platform = process.platform
      const arch = process.arch

      let kotlinArch: string = arch
      if (arch === "arm64") kotlinArch = "aarch64"
      else if (arch === "x64") kotlinArch = "x64"

      let kotlinPlatform: string = platform
      if (platform === "darwin") kotlinPlatform = "mac"
      else if (platform === "linux") kotlinPlatform = "linux"
      else if (platform === "win32") kotlinPlatform = "win"

      const supportedCombos = ["mac-x64", "mac-aarch64", "linux-x64", "linux-aarch64", "win-x64", "win-aarch64"]

      const combo = `${kotlinPlatform}-${kotlinArch}`

      if (!supportedCombos.includes(combo)) {
        log.error(`Platform ${platform}/${arch} is not supported by Kotlin LSP`)
        return
      }

      const assetName = `kotlin-lsp-${version}-${kotlinPlatform}-${kotlinArch}.zip`
      const releaseURL = `https://download-cdn.jetbrains.com/kotlin-lsp/${version}/${assetName}`

      await fs.mkdir(distPath, { recursive: true })
      const archivePath = path.join(distPath, "kotlin-ls.zip")
      await $`curl -L -o '${archivePath}' '${releaseURL}'`.quiet().nothrow()
      const ok = await Archive.extractZip(archivePath, distPath)
        .then(() => true)
        .catch((error) => {
          log.error("Failed to extract Kotlin LS archive", { error })
          return false
        })
      if (!ok) return
      await fs.rm(archivePath, { force: true })
      if (process.platform !== "win32") {
        await $`chmod +x ${launcherScript}`.quiet().nothrow()
      }
      log.info("Installed Kotlin Language Server", { path: launcherScript })
    }
    if (!(await Filesystem.exists(launcherScript))) {
      log.error(`Failed to locate the Kotlin LS launcher script in the installed directory: ${distPath}.`)
      return
    }
    return {
      process: spawn(launcherScript, ["--stdio"], {
        cwd: root,
      }),
    }
  },
}
