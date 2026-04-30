// =============================================================================
// Configuration loader - YAML parsing with environment variable substitution
// =============================================================================

import yaml from "js-yaml";
import type { AppConfig, BoardConfig, TemplateConfig } from "./types";

// =============================================================================
// Environment variable substitution
// =============================================================================

/**
 * Substitutes environment variables in a string.
 * Supports: ${VAR_NAME} and ${VAR_NAME:default_value}
 */
function substituteEnvVars(value: string): string {
  return value.replace(/\$\{(\w+)(?::([^}]*))?\}/g, (_, varName, defaultValue) => {
    return process.env[varName] ?? defaultValue ?? "";
  });
}

/**
 * Recursively substitutes environment variables in an object.
 */
function substituteEnvVarsInObject<T>(obj: T): T {
  if (typeof obj === "string") {
    return substituteEnvVars(obj) as T;
  }
  if (Array.isArray(obj)) {
    return obj.map(substituteEnvVarsInObject) as T;
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = substituteEnvVarsInObject(value);
    }
    return result as T;
  }
  return obj;
}

// =============================================================================
// YAML loading
// =============================================================================

async function loadYamlFile<T>(filePath: string): Promise<T> {
  const file = Bun.file(filePath);
  const exists = await file.exists();

  if (!exists) {
    throw new Error(`Config file not found: ${filePath}`);
  }

  const content = await file.text();
  const parsed = yaml.load(content) as T;
  return substituteEnvVarsInObject(parsed);
}

// =============================================================================
// Config loading
// =============================================================================

export interface LoadConfigOptions {
  boardsPath?: string;
  templatesPath?: string;
}

const DEFAULT_BOARDS_PATH = "config/boards.yaml";
const DEFAULT_TEMPLATES_PATH = "config/templates.yaml";

export async function loadConfig(options: LoadConfigOptions = {}): Promise<AppConfig> {
  const boardsPath = options.boardsPath ?? DEFAULT_BOARDS_PATH;
  const templatesPath = options.templatesPath ?? DEFAULT_TEMPLATES_PATH;

  const [boardsConfig, templatesConfig] = await Promise.all([
    loadYamlFile<{ boards: Record<string, BoardConfig> }>(boardsPath),
    loadYamlFile<{ templates: Record<string, TemplateConfig> }>(templatesPath),
  ]);

  return {
    boards: boardsConfig.boards,
    templates: templatesConfig.templates,
  };
}

export async function loadBoardsConfig(path: string = DEFAULT_BOARDS_PATH): Promise<Record<string, BoardConfig>> {
  const config = await loadYamlFile<{ boards: Record<string, BoardConfig> }>(path);
  return config.boards;
}

export async function loadTemplatesConfig(path: string = DEFAULT_TEMPLATES_PATH): Promise<Record<string, TemplateConfig>> {
  const config = await loadYamlFile<{ templates: Record<string, TemplateConfig> }>(path);
  return config.templates;
}
