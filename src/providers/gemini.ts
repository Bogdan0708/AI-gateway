import { Content, GoogleGenerativeAI } from "@google/generative-ai";
import { probeUrl } from "../lib/readiness";
import {
  CompletionRequest,
  CompletionResponse,
  ProviderConfig,
} from "../types";

const MODELS = [
  "gemini-2.0-flash",
  "gemini-2.5-flash",
  "gemini-1.5-pro-latest",
] as const;
const TIMEOUT_MS = 15_000;

let client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!client) {
    client = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");
  }

  return client;
}

function splitMessages(messages: CompletionRequest["messages"]): {
  systemInstruction?: string;
  history: Content[];
  prompt: string;
} {
  const systemInstruction =
    messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n") || undefined;

  const conversation = messages.filter((message) => message.role !== "system");
  if (conversation.length === 0) {
    throw new Error("Gemini requires at least one non-system message");
  }

  const lastMessage = conversation[conversation.length - 1];
  if (lastMessage.role !== "user") {
    throw new Error("Gemini requires the last message role to be user");
  }

  const history: Content[] = conversation.slice(0, -1).map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));

  return {
    systemInstruction,
    history,
    prompt: lastMessage.content,
  };
}

export async function complete(
  request: CompletionRequest & {
    model: string;
    maxTokens: number;
    temperature: number;
  },
): Promise<CompletionResponse> {
  const { systemInstruction, history, prompt } = splitMessages(
    request.messages,
  );
  const model = getClient().getGenerativeModel({ model: request.model });
  const chat = model.startChat({
    history,
    systemInstruction,
    generationConfig: {
      maxOutputTokens: request.maxTokens,
      temperature: request.temperature,
    },
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const start = Date.now();

  try {
    const result = await chat.sendMessage(prompt, {
      signal: controller.signal,
    });
    const content = result.response.text();
    const usage = result.response.usageMetadata;

    return {
      content,
      provider: "gemini",
      model: request.model,
      usage: {
        promptTokens: usage?.promptTokenCount ?? 0,
        completionTokens: usage?.candidatesTokenCount ?? 0,
        totalTokens: usage?.totalTokenCount ?? 0,
      },
      latencyMs: Date.now() - start,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export const geminiProvider: ProviderConfig = {
  name: "gemini",
  enabled: Boolean(process.env.GOOGLE_API_KEY),
  defaultModel: "gemini-2.0-flash",
  models: [...MODELS],
  checkReadiness: () => probeUrl("https://generativelanguage.googleapis.com"),
  complete,
};
