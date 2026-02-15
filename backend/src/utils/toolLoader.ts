/**
 * Shared tool loader utility.
 *
 * Dynamically loads StructuredTool classes from a directory.
 * Each .ts/.js file in the directory should have a default export
 * that is a StructuredTool class constructor.
 *
 * Usage:
 *   import { loadToolsFromDirectory } from '../../utils/toolLoader.js';
 *   const tools = await loadToolsFromDirectory(join(__dirname, '../tools'));
 */
import { readdirSync } from 'fs';
import { join } from 'path';
import { StructuredTool } from '@langchain/core/tools';
import { logger } from './logger.js';

/**
 * Dynamically loads tool classes from a directory.
 *
 * @param toolsDir  Absolute path to the directory containing tool files.
 * @param label     Optional label for log messages (e.g., 'LLM', 'Minebot').
 * @returns         Array of instantiated StructuredTool objects.
 */
export async function loadToolsFromDirectory(
  toolsDir: string,
  label: string = 'Tools'
): Promise<StructuredTool[]> {
  const toolFiles = readdirSync(toolsDir).filter(
    (file) =>
      (file.endsWith('.ts') || file.endsWith('.js')) &&
      !file.includes('.d.ts')
  );

  const tools: StructuredTool[] = [];

  for (const file of toolFiles) {
    if (file === 'index.ts' || file === 'index.js') continue;

    try {
      const toolModule = await import(join(toolsDir, file));
      const ToolClass = toolModule.default;
      if (ToolClass?.prototype?.constructor) {
        tools.push(new ToolClass());
      }
    } catch (error) {
      logger.error(`[${label}] Tool loading error: ${file}`, error);
    }
  }

  logger.success(`[${label}] ${tools.length} tools loaded`);
  return tools;
}
