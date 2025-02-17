import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

export default class Planning extends StructuredTool {
  name = 'planning';
  description = 'Create a task tree with goals and plans';
  schema = z.object({
    status: z.enum(['pending', 'in_progress', 'completed', 'error']),
    goal: z.string(),
    plan: z.string(),
    subTasks: z.array(
      z.object({
        status: z.enum(['pending', 'in_progress', 'completed', 'error']),
        goal: z.string(),
        plan: z.string(),
      })
    ),
    nextAction: z.enum(['tool_agent', 'make_message', 'END']),
  });

  async _call(data: z.infer<typeof this.schema>) {
    return JSON.stringify(data);
  }
}
