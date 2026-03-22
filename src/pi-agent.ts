import {
  AuthStorage,
  createAgentSession,
  createExtensionRuntime,
  createEventBus,
  loadExtensionFromFactory,
  ModelRegistry,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
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

  // Create the extension runtime and load the open-hax provider extension
  const extensionRuntime = createExtensionRuntime();
  const eventBus = createEventBus();

  // Load the open-hax provider extension using the proper factory loader
  const extension = await loadExtensionFromFactory(openHaxProvider, cwd, eventBus, extensionRuntime);

  // Register providers from the extension's pending registrations
  for (const { name, config } of extensionRuntime.pendingProviderRegistrations) {
    modelRegistry.registerProvider(name, config);
  }

  // Now try to find the model - the extension will have registered the providers
  const explicitModel = provider && modelId ? modelRegistry.find(provider, modelId) : undefined;
  const model = explicitModel ?? modelRegistry.getAvailable()[0];
  if (!model) {
    throw new Error("No authenticated pi model is available for eta-mu. Ensure OPEN_HAX_OPENAI_PROXY_AUTH_TOKEN is set.");
  }

  const resourceLoader: ResourceLoader = {
    getExtensions: () => ({ extensions: [extension], errors: [], runtime: extensionRuntime }),
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