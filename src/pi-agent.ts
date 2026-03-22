import {
  AuthStorage,
  createAgentSession,
  createExtensionRuntime,
  createEventBus,
  ModelRegistry,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
  type ExtensionAPI,
  type ExecResult,
} from "@mariozechner/pi-coding-agent";
import openHaxProvider from "./extensions/open-hax-provider.js";

const extractJson = (text: string): string => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Eta-mu agent did not return JSON: ${text}`);
  }
  return text.slice(start, end + 1);
};

export const runEtaMuPrompt = async (cwd: string, systemPrompt: string, prompt: string, provider?: string, modelId?: string): Promise<string> => {
  const authStorage = AuthStorage.create();
  const modelRegistry = new ModelRegistry(authStorage);

  // Create the extension runtime
  const extensionRuntime = createExtensionRuntime();

  // Create a minimal ExtensionAPI that delegates to the runtime's registerProvider
  const pi: ExtensionAPI = {
    on: () => {},
    registerTool: () => {},
    registerCommand: () => {},
    registerShortcut: () => {},
    registerFlag: () => {},
    registerMessageRenderer: () => {},
    registerProvider: (name, config) => {
      extensionRuntime.registerProvider(name, config);
    },
    unregisterProvider: (name) => {
      extensionRuntime.unregisterProvider(name);
    },
    getFlag: () => undefined,
    sendMessage: () => {},
    sendUserMessage: () => {},
    appendEntry: () => {},
    setSessionName: () => {},
    getSessionName: () => undefined,
    setLabel: () => {},
    getActiveTools: () => [],
    getAllTools: () => [],
    setActiveTools: () => {},
    getCommands: () => [],
    setModel: () => Promise.resolve(false),
    getThinkingLevel: () => "medium",
    setThinkingLevel: () => {},
    exec: () => Promise.resolve({ cwd: "", exitCode: 1, code: 1, killed: false, stdout: "", stderr: "exec not available in eta-mu context" } as ExecResult),
    events: createEventBus(),
  };

  // Load the open-hax provider extension
  openHaxProvider(pi);

  // Register providers from the extension's pending registrations
  for (const { name, config } of extensionRuntime.pendingProviderRegistrations) {
    modelRegistry.registerProvider(name, config);
  }

  // Now try to find the model - the extension will have registered the providers
  // Provider and modelId must be specified together; reject partial specification
  if (provider && !modelId) {
    throw new Error(`Provider "${provider}" specified but modelId is missing. Both provider and modelId must be specified together.`);
  }
  if (!provider && modelId) {
    throw new Error(`Model "${modelId}" specified but provider is missing. Both provider and modelId must be specified together.`);
  }
  
  const explicitModel = provider && modelId ? modelRegistry.find(provider, modelId) : undefined;
  
  // If explicit provider/model was requested but not found, error immediately
  if (provider && modelId && !explicitModel) {
    throw new Error(`Model "${modelId}" not found for provider "${provider}". Available providers: open-hax, open-hax-completions, open-hax-compat, open-hax-responses.`);
  }
  
  // If no explicit model, fall back to first available
  const model = explicitModel ?? modelRegistry.getAvailable()[0];
  if (!model) {
    throw new Error("No authenticated pi model is available for eta-mu. Set one of: OPEN_HAX_OPENAI_PROXY_AUTH_TOKEN, OPEN_HAX_PROXY_AUTH_TOKEN, or OPEN_HAX_AUTH_TOKEN.");
  }

  const resourceLoader: ResourceLoader = {
    getExtensions: () => ({ extensions: [], errors: [], runtime: extensionRuntime }),
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

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: true, maxRetries: 1 },
  });

  const { session } = await createAgentSession({
    cwd,
    model,
    thinkingLevel: "low",
    authStorage,
    modelRegistry,
    resourceLoader,
    tools: [],
    sessionManager: SessionManager.inMemory(),
    settingsManager,
  });

  let output = "";
  session.subscribe((event) => {
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