import type { PluginInput } from "../../../plugin/sdk";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import {YC_STORAGE} from "../../../config/opencode-storage-paths"
import { createInjectedPathsStorage } from "../../../session/session-injected-paths";
import { createDynamicTruncator } from "../../shared/dynamic-truncator";

// ── Config per injector type ──

export interface ContentInjectorConfig {
  /** File to search for (e.g. "AGENTS.md", "README.md") */
  filename: string;
  /** Storage subdirectory name */
  storageName: string;
  /** Label prefix in output (e.g. "Directory Context", "Project README") */
  outputLabel: string;
  /** Whether to skip root directory when searching upward */
  skipRoot: boolean;
}

// ── File finder ──

export function resolveFilePath(rootDirectory: string, path: string): string | null {
  if (!path) return null;
  if (isAbsolute(path)) return path;
  return resolve(rootDirectory, path);
}

export function findFileUp(input: {
  startDir: string;
  rootDir: string;
  filename: string;
  skipRoot: boolean;
}): string[] {
  const found: string[] = [];
  let current = input.startDir;

  while (true) {
    const isRootDir = current === input.rootDir;
    if (!(input.skipRoot && isRootDir)) {
      const filePath = join(current, input.filename);
      if (existsSync(filePath)) {
        found.push(filePath);
      }
    }

    if (isRootDir) break;
    const parent = dirname(current);
    if (parent === current) break;
    if (!parent.startsWith(input.rootDir)) break;
    current = parent;
  }

  return found.reverse();
}

// ── Injection processor ──

type DynamicTruncator = ReturnType<typeof createDynamicTruncator>;

function getSessionCache(
  sessionCaches: Map<string, Set<string>>,
  sessionID: string,
  loadFn: (sessionID: string) => Set<string>,
): Set<string> {
  if (!sessionCaches.has(sessionID)) {
    sessionCaches.set(sessionID, loadFn(sessionID));
  }
  return sessionCaches.get(sessionID)!;
}

async function processFilePath(input: {
  ctx: PluginInput;
  truncator: DynamicTruncator;
  sessionCaches: Map<string, Set<string>>;
  filePath: string;
  sessionID: string;
  output: { title: string; output: string; metadata: unknown };
  config: ContentInjectorConfig;
  loadInjectedPaths: (sessionID: string) => Set<string>;
  saveInjectedPaths: (sessionID: string, paths: Set<string>) => void;
}): Promise<void> {
  const resolved = resolveFilePath(input.ctx.directory, input.filePath);
  if (!resolved) return;

  const dir = dirname(resolved);
  const cache = getSessionCache(input.sessionCaches, input.sessionID, input.loadInjectedPaths);
  const paths = findFileUp({
    startDir: dir,
    rootDir: input.ctx.directory,
    filename: input.config.filename,
    skipRoot: input.config.skipRoot,
  });

  let dirty = false;
  for (const foundPath of paths) {
    const foundDir = dirname(foundPath);
    if (cache.has(foundDir)) continue;

    try {
      const content = readFileSync(foundPath, "utf-8");
      const { result, truncated } = await input.truncator.truncate(
        input.sessionID,
        content,
      );
      const truncationNotice = truncated
        ? `\n\n[Note: Content was truncated to save context window space. For full context, please read the file directly: ${foundPath}]`
        : "";
      input.output.output += `\n\n[${input.config.outputLabel}: ${foundPath}]\n${result}${truncationNotice}`;
      cache.add(foundDir);
      dirty = true;
    } catch {}
  }

  if (dirty) {
    input.saveInjectedPaths(input.sessionID, cache);
  }
}

// ── Hook factory ──

interface ToolExecuteInput {
  tool: string;
  sessionID: string;
  callID: string;
}

interface ToolExecuteOutput {
  title: string;
  output: string;
  metadata: unknown;
}

interface ToolExecuteBeforeOutput {
  args: unknown;
}

interface EventInput {
  event: {
    type: string;
    properties?: unknown;
  };
}

export function createContentInjectorHook(
  ctx: PluginInput,
  config: ContentInjectorConfig,
  modelCacheState?: { anthropicContext1MEnabled: boolean },
) {
  const storagePath = join(YC_STORAGE, config.storageName);
  const { loadInjectedPaths, saveInjectedPaths, clearInjectedPaths } =
    createInjectedPathsStorage(storagePath);

  const sessionCaches = new Map<string, Set<string>>();
  const truncator = createDynamicTruncator(ctx, modelCacheState);

  const toolExecuteAfter = async (input: ToolExecuteInput, output: ToolExecuteOutput) => {
    const toolName = input.tool.toLowerCase();

    if (toolName === "read") {
      await processFilePath({
        ctx,
        truncator,
        sessionCaches,
        filePath: output.title,
        sessionID: input.sessionID,
        output,
        config,
        loadInjectedPaths,
        saveInjectedPaths,
      });
    }
  };

  const toolExecuteBefore = async (
    input: ToolExecuteInput,
    output: ToolExecuteBeforeOutput,
  ): Promise<void> => {
    void input;
    void output;
  };

  const eventHandler = async ({ event }: EventInput) => {
    const props = event.properties as Record<string, unknown> | undefined;

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined;
      if (sessionInfo?.id) {
        sessionCaches.delete(sessionInfo.id);
        clearInjectedPaths(sessionInfo.id);
      }
    }

    if (event.type === "session.compacted") {
      const sessionID = (props?.sessionID ??
        (props?.info as { id?: string } | undefined)?.id) as string | undefined;
      if (sessionID) {
        sessionCaches.delete(sessionID);
        clearInjectedPaths(sessionID);
      }
    }
  };

  return {
    "tool.execute.before": toolExecuteBefore,
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  };
}