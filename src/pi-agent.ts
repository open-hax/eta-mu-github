import {
  AuthStorage,
  createAgentSession,
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  discoverAndLoadExtensions,
  ModelRegistry,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
  type ExtensionAPI,
  type ExtensionRuntime,
  type ProviderConfig,
} from "@mariozechner/pi-coding-agent";
import path from "node:path";
import fs from "node:fs";
import openHaxProvider from "./extensions/open-hax-provider.js";

const extractJson = (text: string): string => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Eta-mu agent did not return JSON: ${text}`);
  }
  return text.slice(start, end + 1);
};

const getAgentDir = (): string | undefined => {
  const explicit = process.env.PI_CODING_AGENT_DIR;
  if (explicit && fs.existsSync(explicit)) {
    return explicit;
  }
  // Fallback: ~/.pi/agent
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (home) {
    const defaultDir = path.join(home, ".pi", "agent");
    if (fs.existsSync(defaultDir)) {
      return defaultDir;
    }
  }
  return undefined;
};

const registerBundledProviders = (runtime: ExtensionRuntime): void => {
  const providerRegistrationApi = {
    registerProvider: (name: string, config: ProviderConfig) => {
      runtime.registerProvider(name, config);
    },
  } as unknown as ExtensionAPI;

  openHaxProvider(providerRegistrationApi);
};

const flushProviderRegistrations = (runtime: ExtensionRuntime, modelRegistry: ModelRegistry): void => {
  const pending = runtime.pendingProviderRegistrations ?? [];
  for (const { name, config } of pending) {
    modelRegistry.registerProvider(name, config);
  }
  runtime.pendingProviderRegistrations = [];
};

const createResourceLoader = async (
  systemPrompt: string,
  cwd: string,
  modelRegistry: ModelRegistry,
): Promise<ResourceLoader> => {
  const agentDir = getAgentDir();

  // Load extensions from the configured/global agent directory. The returned
  // runtime queues provider registrations until we can flush them into the
  // concrete ModelRegistry used by this GitHub automation session.
  const extensionsResult = await discoverAndLoadExtensions(
    [],
    cwd,
    agentDir,
    undefined,
  );
  const { extensions, errors, runtime } = extensionsResult;

  if (errors.length > 0) {
    for (const { path, error } of errors) {
      console.error(`eta-mu extension error (${path}): ${error}`);
    }
  }

  registerBundledProviders(runtime);
  flushProviderRegistrations(runtime, modelRegistry);

  return {
    getExtensions: () => ({ extensions, errors, runtime }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getAppendSystemPrompt: () => [],
    getPathMetadata: () => new Map(),
    extendResources: () => {},
    reload: async () => {},
  };
};

const selectModel = (modelRegistry: ModelRegistry, provider?: string, modelId?: string) => {
  if (provider && !modelId) {
    throw new Error(`Provider "${provider}" specified but modelId is missing. Both provider and modelId must be specified together.`);
  }
  if (!provider && modelId) {
    throw new Error(`Model "${modelId}" specified but provider is missing. Both provider and modelId must be specified together.`);
  }

  const explicitModel = provider && modelId ? modelRegistry.find(provider, modelId) : undefined;
  if (provider && modelId && !explicitModel) {
    throw new Error(`Model "${modelId}" not found for provider "${provider}".`);
  }

  return explicitModel ?? modelRegistry.getAvailable()[0];
};

const createBaseSession = async (
  cwd: string,
  systemPrompt: string,
  tools: any[],
  provider?: string,
  modelId?: string,
) => {
  const authStorage = AuthStorage.create();
  const modelRegistry = new ModelRegistry(authStorage);

  // Load resource loader with extensions from PI_CODING_AGENT_DIR and the
  // bundled open-hax provider extension. This also flushes provider
  // registrations to the ModelRegistry before model selection.
  const resourceLoader = await createResourceLoader(systemPrompt, cwd, modelRegistry);

  const model = selectModel(modelRegistry, provider, modelId);
  if (!model) {
    throw new Error("No authenticated pi model is available for eta-mu. Set one of: OPEN_HAX_OPENAI_PROXY_AUTH_TOKEN, OPEN_HAX_PROXY_AUTH_TOKEN, or OPEN_HAX_AUTH_TOKEN.");
  }

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: true, maxRetries: 1 },
  });

  return createAgentSession({
    cwd,
    model,
    thinkingLevel: tools.length > 0 ? "medium" : "low",
    authStorage,
    modelRegistry,
    resourceLoader,
    tools,
    sessionManager: SessionManager.inMemory(),
    settingsManager,
  });
};

export const runEtaMuPrompt = async (
  cwd: string,
  systemPrompt: string,
  prompt: string,
  provider?: string,
  modelId?: string,
): Promise<string> => {
  const { session } = await createBaseSession(cwd, systemPrompt, [], provider, modelId);
  let output = "";
  session.subscribe((event: any) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      output += event.assistantMessageEvent.delta;
    }
  });

  try {
    await session.prompt(prompt);
    return extractJson(output.trim());
  } finally {
    session.dispose();
  }
};

export const runEtaMuAutofix = async (
  cwd: string,
  systemPrompt: string,
  prompt: string,
  provider?: string,
  modelId?: string,
): Promise<string> => {
  const tools = [
    createReadTool(cwd),
    createEditTool(cwd),
    createWriteTool(cwd),
    createBashTool(cwd),
  ];
  const { session } = await createBaseSession(cwd, systemPrompt, tools, provider, modelId);
  let output = "";
  session.subscribe((event: any) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      output += event.assistantMessageEvent.delta;
    }
  });

  try {
    await session.prompt(prompt);
    return output.trim();
  } finally {
    session.dispose();
  }
};
