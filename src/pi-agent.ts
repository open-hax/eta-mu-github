import {
  AuthStorage,
  createAgentSession,
  createExtensionRuntime,
  ModelRegistry,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";

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
  const explicitModel = provider && modelId ? modelRegistry.find(provider, modelId) : undefined;
  const model = explicitModel ?? modelRegistry.getAvailable()[0];
  if (!model) {
    throw new Error("No authenticated pi model is available for eta-mu");
  }

  const resourceLoader: ResourceLoader = {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
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
