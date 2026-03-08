/**
 * Shannon Unified Graph
 *
 * Single core graph that handles all channels.
 * Delegates to existing nodes (EmotionNode, MemoryNode, FCA) via stateBridge.
 *
 * Flow:
 *   ingest → classify → [emotion + recall] → route → execute → format → writeback
 *
 * Phase 1: Wraps existing nodes. Does NOT replace TaskGraph yet —
 * can be invoked alongside it via the stateBridge.
 */

import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';
import type {
  RequestEnvelope,
  ShannonGraphState,
  ShannonMode,
  ShannonActionPlan,
  MemoryItem,
  ToolCallRecord,
  ShannonPlan,
  SelfModProposal,
  UserProfileSnapshot,
  EmotionType,
  TaskTreeState,
} from '@shannon/common';
import {
  inferInitialMode,
  toTaskStateInput,
  envelopeToTaskContext,
} from './stateBridge.js';
import { actionFormatterNode } from '../../common/adapters/actionFormatter.js';
import { EmotionNode, EmotionState } from './nodes/EmotionNode.js';
import { MemoryNode, MemoryState } from './nodes/MemoryNode.js';
import { FunctionCallingAgent } from './nodes/FunctionCallingAgent.js';
import { ClassifyNode } from './nodes/ClassifyNode.js';
import type { ExecutionResult } from './types.js';

// ---------------------------------------------------------------------------
// LangGraph Annotation (state schema with reducers)
// ---------------------------------------------------------------------------

const replace = <T>(_: T, next: T) => next;
const append = <T>(prev: T[], next: T[]) => [...prev, ...next];

const ShannonState = Annotation.Root({
  // -- input --
  envelope: Annotation<RequestEnvelope>({ reducer: replace, default: () => ({} as RequestEnvelope) }),

  // -- user & context --
  userProfile: Annotation<UserProfileSnapshot | undefined>({ reducer: replace, default: () => undefined }),
  conversationSummary: Annotation<string | undefined>({ reducer: replace, default: () => undefined }),
  recentMessages: Annotation<string[] | undefined>({ reducer: replace, default: () => undefined }),

  // -- classification --
  mode: Annotation<ShannonMode | undefined>({ reducer: replace, default: () => undefined }),
  intent: Annotation<string | undefined>({ reducer: replace, default: () => undefined }),
  riskLevel: Annotation<'low' | 'mid' | 'high' | undefined>({ reducer: replace, default: () => undefined }),
  needsTools: Annotation<boolean | undefined>({ reducer: replace, default: () => undefined }),
  needsPlanning: Annotation<boolean | undefined>({ reducer: replace, default: () => undefined }),
  needsSelfModification: Annotation<boolean | undefined>({ reducer: replace, default: () => undefined }),

  // -- emotion --
  emotion: Annotation<EmotionType | undefined>({ reducer: replace, default: () => undefined }),

  // -- memory --
  relevantMemories: Annotation<MemoryItem[]>({ reducer: replace, default: () => [] }),

  // -- planning --
  plan: Annotation<ShannonPlan | undefined>({ reducer: replace, default: () => undefined }),
  taskTree: Annotation<TaskTreeState | undefined>({ reducer: replace, default: () => undefined }),

  // -- tool execution --
  toolBudget: Annotation<number | undefined>({ reducer: replace, default: () => undefined }),
  allowedTools: Annotation<string[] | undefined>({ reducer: replace, default: () => undefined }),
  toolCalls: Annotation<ToolCallRecord[]>({ reducer: append, default: () => [] }),
  retrievedFacts: Annotation<string[]>({ reducer: append, default: () => [] }),

  // -- FCA result --
  fcaSummary: Annotation<string | undefined>({ reducer: replace, default: () => undefined }),

  // -- output --
  actionPlan: Annotation<ShannonActionPlan | undefined>({ reducer: replace, default: () => undefined }),
  selfModProposal: Annotation<SelfModProposal | undefined>({ reducer: replace, default: () => undefined }),
  finalAnswer: Annotation<string | undefined>({ reducer: replace, default: () => undefined }),

  // -- observability --
  trace: Annotation<string[]>({ reducer: append, default: () => [] }),
  warnings: Annotation<string[]>({ reducer: append, default: () => [] }),

  // -- internal: bridge data for existing nodes --
  _legacyMessages: Annotation<BaseMessage[]>({ reducer: replace, default: () => [] }),
  _emotionState: Annotation<EmotionState | undefined>({ reducer: replace, default: () => undefined }),
  _memoryState: Annotation<MemoryState | undefined>({ reducer: replace, default: () => undefined }),
});

/** Type alias for the LangGraph state shape. */
type ShannonStateType = typeof ShannonState.State;

// ---------------------------------------------------------------------------
// Node implementations
// ---------------------------------------------------------------------------

/**
 * ingest: Initializes state from the envelope.
 */
async function ingestNode(state: ShannonStateType): Promise<Partial<ShannonStateType>> {
  const mode = inferInitialMode(state.envelope);
  return { mode, trace: ['node:ingest'] };
}

/**
 * classify: LLM-based classification via ClassifyNode.
 * Falls back to heuristic on failure.
 */
function createClassifyNodeWrapper() {
  const classifyNodeInstance = new ClassifyNode();
  return async function classifyWrapper(state: ShannonStateType): Promise<Partial<ShannonStateType>> {
    const result = await classifyNodeInstance.invoke(state.envelope);
    return {
      mode: result.mode as ShannonMode,
      intent: result.intent,
      riskLevel: result.riskLevel,
      needsTools: result.needsTools,
      needsPlanning: result.needsPlanning,
      trace: ['node:classify'],
    };
  };
}

/**
 * minebotRoute: Publishes minebot events via EventBus for minecraft modes.
 * The actual execution is handled by SkillAgent, not the Shannon FCA.
 */
async function minebotRouteNode(state: ShannonStateType): Promise<Partial<ShannonStateType>> {
  const { getEventBus } = await import('../../../events/eventBus.js');
  const eventBus = getEventBus();
  const envelope = state.envelope;

  const eventType = state.mode === 'minecraft_emergency'
    ? 'minebot:emergency'
    : 'minebot:voice_chat';

  eventBus.publish({
    type: eventType,
    memoryZone: 'minebot',
    data: {
      userName: envelope.userId ?? 'unknown',
      message: envelope.text ?? '',
      guildId: envelope.discord?.guildId,
      channelId: envelope.discord?.channelId,
      isEmergency: state.mode === 'minecraft_emergency',
    },
  });

  return {
    finalAnswer: state.mode === 'minecraft_emergency'
      ? '⚠️ 緊急対応中...'
      : '🎮 Minecraftで実行中...',
    trace: ['node:minebot_route'],
  };
}

/** Route after classify: minecraft modes go to minebotRoute, others to emotion+recall in parallel. */
function classifyRouter(state: ShannonStateType): string[] {
  if (state.mode === 'minecraft_action' || state.mode === 'minecraft_emergency') {
    return ['minebot_route'];
  }
  return ['emotion', 'recall'];
}

/**
 * emotionNode wrapper: Delegates to existing EmotionNode.invoke(state).
 * EmotionNode.invoke takes a single state object and returns { emotion: EmotionType }.
 */
function createEmotionNodeWrapper(emotionNode: EmotionNode) {
  return async function emotionWrapper(state: ShannonStateType): Promise<Partial<ShannonStateType>> {
    const legacyInput = {
      userMessage: state.envelope.text ?? null,
      context: envelopeToTaskContext(state.envelope),
    };

    const result = await emotionNode.invoke(legacyInput);
    const emotionState: EmotionState = { current: result.emotion };

    return {
      emotion: result.emotion ?? undefined,
      _emotionState: emotionState,
      trace: ['node:emotion'],
    };
  };
}

/**
 * recallNode wrapper: Delegates to existing MemoryNode.preProcess.
 * MemoryNode.preProcess takes { userMessage, context } and returns MemoryState.
 */
function createRecallNodeWrapper(memoryNode: MemoryNode) {
  return async function recallWrapper(state: ShannonStateType): Promise<Partial<ShannonStateType>> {
    const input = {
      userMessage: state.envelope.text ?? null,
      context: envelopeToTaskContext(state.envelope),
    };

    const memoryState = await memoryNode.preProcess(input);
    const formatted = memoryState
      ? await memoryNode.formatForSystemPrompt(memoryState)
      : '';

    return {
      _memoryState: memoryState ?? undefined,
      retrievedFacts: formatted ? [formatted] : [],
      trace: ['node:recall'],
    };
  };
}

/**
 * executeNode wrapper: Delegates to existing FunctionCallingAgent.run().
 *
 * FCA.run expects FunctionCallingAgentState:
 *   { taskId, userMessage, messages, emotionState, memoryState,
 *     context, channelId, environmentState, isEmergency, onToolsExecuted, ... }
 */
function createExecuteNodeWrapper(fca: FunctionCallingAgent, emotionNode?: EmotionNode) {
  return async function executeWrapper(state: ShannonStateType): Promise<Partial<ShannonStateType>> {
    const envelope = state.envelope;
    const context = envelopeToTaskContext(envelope);
    const emotionState: EmotionState = state._emotionState ?? { current: state.emotion ?? null };

    const agentResult = await fca.run(
      {
        taskId: envelope.requestId,
        userMessage: envelope.text ?? null,
        messages: state._legacyMessages,
        emotionState,
        memoryState: state._memoryState,
        context,
        channelId: envelope.discord?.channelId ?? envelope.conversationId,
        environmentState: (envelope.metadata?.environmentState as string) ?? null,
        isEmergency: envelope.tags.includes('emergency'),
        onToolsExecuted: (messages: BaseMessage[], results: ExecutionResult[]) => {
          // Async emotion re-evaluation (fire-and-forget)
          if (emotionNode) {
            emotionNode
              .evaluateAsync(messages, results, emotionState.current)
              .then((newEmotion) => {
                emotionState.current = newEmotion;
              })
              .catch(() => {});
          }
        },
      },
    );

    return {
      finalAnswer: agentResult.taskTree?.responseMessage ?? undefined,
      taskTree: agentResult.taskTree ?? undefined,
      emotion: emotionState.current ?? undefined,
      trace: ['node:execute'],
    };
  };
}

/**
 * formatNode: Converts finalAnswer into channel-specific ShannonActionPlan.
 */
async function formatNode(state: ShannonStateType): Promise<Partial<ShannonStateType>> {
  const result = await actionFormatterNode(state as unknown as ShannonGraphState);
  return {
    actionPlan: result.actionPlan,
    trace: ['node:format'],
  };
}

/**
 * writebackNode: Fires MemoryNode.postProcess asynchronously.
 */
function createWritebackNodeWrapper(memoryNode: MemoryNode) {
  return async function writebackWrapper(state: ShannonStateType): Promise<Partial<ShannonStateType>> {
    const context = envelopeToTaskContext(state.envelope);
    const userText = state.envelope.text ?? '';
    const answer = state.finalAnswer ?? '';

    // Build conversation text for memory extraction
    const conversationText = `User: ${userText}\nShannon: ${answer}`;

    // Fire-and-forget
    memoryNode.postProcess({
      context,
      conversationText,
      exchanges: [
        { role: 'user', content: userText, timestamp: new Date() },
        { role: 'assistant', content: answer, timestamp: new Date() },
      ],
    }).catch(() => {});

    return { trace: ['node:writeback'] };
  };
}

// ---------------------------------------------------------------------------
// Graph construction
// ---------------------------------------------------------------------------

export interface ShannonGraphDeps {
  emotionNode: EmotionNode;
  memoryNode: MemoryNode;
  fca: FunctionCallingAgent;
}

/**
 * Build and compile the Shannon unified graph.
 *
 * Returns a compiled LangGraph that can be invoked with:
 *   graph.invoke({ envelope: RequestEnvelope, _legacyMessages: [...] })
 */
export function buildShannonGraph(deps: ShannonGraphDeps) {
  const workflow = new StateGraph(ShannonState)
    .addNode('ingest', ingestNode)
    .addNode('classify', createClassifyNodeWrapper())
    .addNode('minebot_route', minebotRouteNode)
    .addNode('emotion', createEmotionNodeWrapper(deps.emotionNode))
    .addNode('recall', createRecallNodeWrapper(deps.memoryNode))
    .addNode('execute', createExecuteNodeWrapper(deps.fca, deps.emotionNode))
    .addNode('format', formatNode)
    .addNode('writeback', createWritebackNodeWrapper(deps.memoryNode))

    // ingest → classify → conditional routing
    .addEdge(START, 'ingest')
    .addEdge('ingest', 'classify')

    // classify → minecraft? → minebot_route → format → writeback → END
    // classify → other?    → [emotion, recall] → execute → format → writeback → END
    .addConditionalEdges('classify', classifyRouter, {
      minebot_route: 'minebot_route',
      emotion: 'emotion',
      recall: 'recall',
    })
    .addEdge('minebot_route', 'format')
    .addEdge('emotion', 'execute')
    .addEdge('recall', 'execute')
    .addEdge('execute', 'format')
    .addEdge('format', 'writeback')
    .addEdge('writeback', END);

  return workflow.compile();
}

// ---------------------------------------------------------------------------
// Convenience invoke wrapper
// ---------------------------------------------------------------------------

export type CompiledShannonGraph = ReturnType<typeof buildShannonGraph>;

/**
 * Invoke the unified Shannon graph with a RequestEnvelope.
 */
export async function invokeShannonGraph(
  graph: CompiledShannonGraph,
  envelope: RequestEnvelope,
  legacyMessages?: BaseMessage[],
): Promise<ShannonGraphState> {
  const result = await graph.invoke({
    envelope,
    _legacyMessages: legacyMessages ?? [],
  });

  return result as unknown as ShannonGraphState;
}
