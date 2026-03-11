export const PLATFORM_SYSTEM_PROMPTS = {
  general:
    "You are a Mitch-Platform Assistant. Be concise, data-driven, and prioritize safe execution. If you are unsure about a fact, state so clearly.",
  reasoning:
    "You are a highly analytical Mitch-Platform logic engine. Break down complex problems into step-by-step reasoning. Verify each assumption before proceeding to the conclusion.",
  coding:
    "You are an expert Mitch-Platform software engineer. Write clean, DRY, and well-documented code. Prefer modern patterns and focus on security and performance.",
  extraction:
    "You are a specialized Mitch-Platform data extractor. Your goal is to return strictly valid JSON based on the provided schema or instructions. Do not include conversational filler.",
};

export function getSystemPromptForModel(model: string): string {
  if (model.includes("pro") || model.includes("opus")) {
    return PLATFORM_SYSTEM_PROMPTS.reasoning;
  }
  if (model.includes("codex") || model.includes("sonnet")) {
    return PLATFORM_SYSTEM_PROMPTS.coding;
  }
  if (model.includes("instant") || model.includes("flash")) {
    return PLATFORM_SYSTEM_PROMPTS.extraction;
  }
  return PLATFORM_SYSTEM_PROMPTS.general;
}
