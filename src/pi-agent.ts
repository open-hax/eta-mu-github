import {
  AuthStorage,
  createAgentSession,
  createBashTool,
  createEditTool,
  createExtensionRuntime,
  createReadTool,
  createWriteTool,
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

const createResourceLoader = (systemPrompt: string): ResourceLoader => ({
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
});

const selectModel = (modelRegistry: ModelRegistry, provider?: string, modelId?: string) => {
  const explicitModel = provider && modelId ? modelRegistry.find(provider, modelId) : undefined;
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
  const model = selectModel(modelRegistry, provider, modelId);
  if (!model) {
    throw new Error("No authenticated pi model is available for eta-mu");
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
    resourceLoader: createResourceLoader(systemPrompt),
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
