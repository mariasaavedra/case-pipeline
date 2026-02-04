// =============================================================================
// Relationship Map Library
// =============================================================================
// Analyzes and visualizes Monday.com board relationships.
//
// Usage:
//   import { analyzeBoards, renderMarkdownDocument, renderJSON } from "./lib/relationship-map";
//
//   const data = analyzeBoards(boards, { mainBoardKey: "profiles" });
//   const markdown = renderMarkdownDocument(data);
//   const json = renderJSON(data);
//
// =============================================================================

// Core types
export type {
  RelationshipMapData,
  MapBoard,
  BoardConnection,
  MirrorColumn,
  BoardMirrors,
  AnalyzerOptions,
  RenderOptions,
} from "./types";

// Analyzer
export { analyzeBoards } from "./analyzer";

// Renderers
export { renderMarkdownDocument, renderIllustratedDocument } from "./renderers/markdown";
export {
  renderSimpleDiagram,
  renderMentalMap,
  renderDataFlowDiagram,
  renderAllDiagrams,
} from "./renderers/mermaid";
export {
  renderJSON,
  renderJSModule,
  toUIFormat,
  type UINode,
  type UIEdge,
  type UIGraphData,
} from "./renderers/json";

// Convenience function to generate all outputs at once
import type { MondayBoard } from "../monday/types";
import type { AnalyzerOptions, RenderOptions } from "./types";
import { analyzeBoards } from "./analyzer";
import { renderMarkdownDocument, renderIllustratedDocument } from "./renderers/markdown";
import { renderJSON, renderJSModule } from "./renderers/json";

export interface GenerateOptions extends AnalyzerOptions, RenderOptions {
  /** Include JSON output file */
  includeJSON?: boolean;
  /** Include JS module output file */
  includeJSModule?: boolean;
  /** Include illustrated/detailed version */
  includeIllustrated?: boolean;
}

export interface GeneratedOutput {
  markdown: string;
  illustrated?: string;
  json?: string;
  jsModule?: string;
}

/**
 * Generate all relationship map outputs in one call
 */
export function generateRelationshipMap(
  boards: Map<string, MondayBoard>,
  options: GenerateOptions = {}
): GeneratedOutput {
  const data = analyzeBoards(boards, options);

  const output: GeneratedOutput = {
    markdown: renderMarkdownDocument(data, options),
  };

  if (options.includeIllustrated) {
    output.illustrated = renderIllustratedDocument(data, options);
  }

  if (options.includeJSON) {
    output.json = renderJSON(data);
  }

  if (options.includeJSModule) {
    output.jsModule = renderJSModule(data);
  }

  return output;
}
