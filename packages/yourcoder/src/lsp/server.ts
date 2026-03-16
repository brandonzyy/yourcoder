import type { Handle as ServerHandle, Info as ServerInfo } from "./server/shared"
import {
  Astro as AstroServer,
  Biome as BiomeServer,
  Deno as DenoServer,
  ESLint as ESLintServer,
  Oxlint as OxlintServer,
  Svelte as SvelteServer,
  Typescript as TypescriptServer,
  Vue as VueServer,
} from "./server/web"
import {
  BashLS as BashLSServer,
  Clojure as ClojureServer,
  Dart as DartServer,
  DockerfileLS as DockerfileLSServer,
  Gleam as GleamServer,
  LuaLS as LuaLSServer,
  Nixd as NixdServer,
  Ocaml as OcamlServer,
  PHPIntelephense as PHPIntelephenseServer,
  Prisma as PrismaServer,
  YamlLS as YamlLSServer,
} from "./server/scripting"
import {
  Clangd as ClangdServer,
  CSharp as CSharpServer,
  FSharp as FSharpServer,
  Gopls as GoplsServer,
  RustAnalyzer as RustAnalyzerServer,
  SourceKit as SourceKitServer,
  Zls as ZlsServer,
} from "./server/systems"
import { Pyright as PyrightServer, Rubocop as RubocopServer, Ty as TyServer } from "./server/python"
import { ElixirLS as ElixirLSServer, JDTLS as JDTLSServer, KotlinLS as KotlinLSServer } from "./server/jvm"
import {
  HLS as HLSServer,
  JuliaLS as JuliaLSServer,
  TerraformLS as TerraformLSServer,
  TexLab as TexLabServer,
  Tinymist as TinymistServer,
} from "./server/docs"

export namespace LSPServer {
  export type Handle = ServerHandle
  export type Info = ServerInfo

  export const Astro = AstroServer
  export const BashLS = BashLSServer
  export const Biome = BiomeServer
  export const Clangd = ClangdServer
  export const Clojure = ClojureServer
  export const CSharp = CSharpServer
  export const Dart = DartServer
  export const Deno = DenoServer
  export const DockerfileLS = DockerfileLSServer
  export const ElixirLS = ElixirLSServer
  export const ESLint = ESLintServer
  export const FSharp = FSharpServer
  export const Gleam = GleamServer
  export const Gopls = GoplsServer
  export const HLS = HLSServer
  export const JDTLS = JDTLSServer
  export const JuliaLS = JuliaLSServer
  export const KotlinLS = KotlinLSServer
  export const LuaLS = LuaLSServer
  export const Nixd = NixdServer
  export const Ocaml = OcamlServer
  export const Oxlint = OxlintServer
  export const PHPIntelephense = PHPIntelephenseServer
  export const Prisma = PrismaServer
  export const Pyright = PyrightServer
  export const Rubocop = RubocopServer
  export const RustAnalyzer = RustAnalyzerServer
  export const SourceKit = SourceKitServer
  export const Svelte = SvelteServer
  export const TerraformLS = TerraformLSServer
  export const TexLab = TexLabServer
  export const Tinymist = TinymistServer
  export const Ty = TyServer
  export const Typescript = TypescriptServer
  export const Vue = VueServer
  export const YamlLS = YamlLSServer
  export const Zls = ZlsServer
}
