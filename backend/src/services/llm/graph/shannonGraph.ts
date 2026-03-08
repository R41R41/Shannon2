/**
 * Shannon Unified Graph
 *
 * Single core graph that handles all channels.
 * 1 identity, 1 core graph, N channel adapters.
 *
 * Flow:
 *   ingest → classify → [emotion ∥ recall] → execute → format → writeback → END
 *                      → [minebot_route]    → format → writeback → END
 *
 * Memory: uses ScopedMemoryService directly (no MemoryNode wrapper).
 * Emotion: delegates to EmotionNode.
 * Execution: delegates to FunctionCallingAgent.
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
import { inferInitialMode, envelopeToTaskContext } from './stateBridge.js';
import { actionFormatterNode } from '../../common/adapters/actionFormatter.js';
import { EmotionNode, EmotionState } from './nodes/EmotionNode.js';
import { FunctionCallingAgent } from './nodes/FunctionCallingAgent.js';
import { ClassifyNode } from './nodes/ClassifyNode.js';
import { ScopedMemoryService } from '../../memory/scopedMemoryService.js';
import type { ExecutionResult } from './types.js';

// ---------------------------------------------------------------------------
// LangGraph Annotation (state schema)
// ---------------------------------------------------------------------------

const replace = <T>(_: T, next: T) => next;
const append = <T>(prev: T[], next: T[]) => [...prev, ...next];

const ShannonState = Annotation.Root({
  // -- input --
  envelope: Annotation<RequestEnvelope>({ reducer: replace, default: () => ({} as RequestEnvelope) }),

  // -- classification --
  mode: Annotation<ShannonMode | undefined>({ reducer: replace, default: () => undefined }),
  intent: Annotation<string | undefined>({ reducer: replace, default: () => undefined }),
  riskLevel: Annotation<'low' | 'mid' | 'high' | undefined>({ reducer: replace, default: () => undefined }),
  needsTools: Annotation<boolean | undefined>({ reducer: replace, default: () => undefined }),
  needsPlanning: Annotation<boolean | undefined>({ reducer: replace, default: () => undefined }),

  // -- emotion --
  emotion: Annotation<EmotionType | undefined>({ reducer: replace, default: () => undefined }),

  // -- memory (scoped recall result) --
  memoryPrompt: Annotation<string>({ reducer: replace, default: () => '' }),

  // -- planning --
  plan: Annotation<ShannonPlan | undefined>({ reducer: replace, default: () => undefined }),
  taskTree: Annotation<TaskTreeState | undefined>({ reducer: replace, default: () => undefined }),

  // -- tool execution --
  allowedTools: Annotation<string[] | undefined>({ reducer: replace, default: () => undefined }),
  toolCalls: Annotation<ToolCallRecord[]>({ reducer: append, default: () => [] }),
  retrievedFacts: Annotation<string[]>({ reducer: append, default: () => [] }),

  // -- output --
  actionPlan: Annotation<ShannonActionPlan | undefined>({ reducer: replace, default: () => undefined }),
  finalAnswer: Annotation<string | undefined>({ reducer: replace, default: () => undefined }),

  // -- observability --
  trace: Annotation<string[]>({ reducer: append, default: () => [] }),
  warnings: Annotation<string[]>({ reducer: append, default: () => [] }),

  // -- bridge: messages for FCA (until FCA accepts envelope directly) --
  _legacyMessages: Annotation<BaseMessage[]>({ reducer: replace, default: () => [] }),
  _emotionState: Annotation<EmotionState | undefined>({ reducer: replace, default: () => undefined }),
});

type ShannonStateType = typeof ShannonState.State;

// ---------------------------------------------------------------------------
// Shared singletons (initialized once at graph build time)
// ---------------------------------------------------------------------------

const classifyNode = new ClassifyNode();
const scopedMemory = ScopedMemoryService.getInstance();

// ---------------------------------------------------------------------------
// Node implementations
// ---------------------------------------------------------------------------

async function ingestNode(state: ShannonStateType): Promise<Partial<ShannonStateType>> {
  const mode = inferInitialMode(state.envelope);
  return { mode, trace: ['node:ingest'] };
}

async function classifyNodeFn(state: ShannonStateType): Promise<Partial<ShannonStateType>> {
  const result = await classifyNode.invoke(state.envelope);
  return {
    mode: result.mode as ShannonMode,
    intent: result.intent,
    riskLevel: result.riskLevel,
    needsTools: result.needsTools,
    needsPlanning: result.needsPlanning,
    trace: ['node:classify'],
  };
}

async function minebotRouteNode(state: ShannonStateType): Promise<Partial<ShannonStateType>> {
  const { getEventBus } = await import('../../../events/eventBus.js');
  const eventBus = getEventBus();
  const envelope = state.envelope;

  eventBus.publish({
    type: state.mode === 'minecraft_emergency' ? 'minebot:emergency' : 'minebot:voice_chat',
    memoryZone: 'minebot',
    data: {
      userName: envelope.sourceUserId ?? 'unknown',
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

function classifyRouter(state: ShannonStateType): string[] {
  if (state.mode === 'minecraft_action' || state.mode === 'minecraft_emergency') {
    return ['minebot_route'];
  }
  return ['emotion', 'recall'];
}

/**
 * emotion: Delegates to EmotionNode.
 */
function createEmotionNode(emotionNode: EmotionNode) {
  return async function emotionFn(state: ShannonStateType): Promise<Partial<ShannonStateType>> {
    const result = await emotionNode.invoke({
      userMessage: state.envelope.text ?? null,
      context: envelopeToTaskContext(state.envelope),
    });
    const emotionState: EmotionState = { current: result.emotion };
    return {
      emotion: result.emotion ?? undefined,
      _emotionState: emotionState,
      trace: ['node:emotion'],
    };
  };
}

/**
 * recall: Scoped memory retrieval via ScopedMemoryService.
 * No MemoryNode wrapper — queries directly with privacy filter and ranking.
 */
async function recallNode(state: ShannonStateType): Promise<Partial<ShannonStateType>> {
  const result = await scopedMemory.recall({
    envelope: state.envelope,
    text: state.envelope.text ?? '',
  });

  return {
    memoryPrompt: result.formattedPrompt,
    retrievedFacts: result.formattedPrompt ? [result.formattedPrompt] : [],
    trace: ['node:recall'],
  };
}

/**
 * execute: Delegates to FCA with envelope-derived context.
 */
function createExecuteNode(fca: FunctionCallingAgent, emotionNode?: EmotionNode) {
  return async function executeFn(state: ShannonStateType): Promise<Partial<ShannonStateType>> {
    const envelope = state.envelope;
    const context = envelopeToTaskContext(envelope);
    const emotionState: EmotionState = state._emotionState ?? { current: state.emotion ?? null };

    const agentResult = await fca.run({
      taskId: envelope.requestId,
      userMessage: envelope.text ?? null,
      messages: state._legacyMessages,
      emotionState,
      memoryState: null, // No longer passing MemoryState — memory is in retrievedFacts/memoryPrompt
      context,
      channelId: envelope.discord?.channelId ?? envelope.conversationId,
      environmentState: (envelope.metadata?.environmentState as string) ?? null,
      isEmergency: envelope.tags.includes('emergency'),
      memoryPrompt: state.memoryPrompt || undefined,
      onToolsExecuted: (messages: BaseMessage[], results: ExecutionResult[]) => {
        if (emotionNode) {
          emotionNode
            .evaluateAsync(messages, results, emotionState.current)
            .then((e) => { emotionState.current = e; })
            .catch(() => {});
        }
      },
    });

    return {
      finalAnswer: agentResult.taskTree?.responseMessage ?? undefined,
      taskTree: agentResult.taskTree ?? undefined,
      emotion: emotionState.current ?? undefined,
      trace: ['node:execute'],
    };
  };
}

async function formatNode(state: ShannonStateType): Promise<Partial<ShannonStateType>> {
  const result = await actionFormatterNode(state as unknown as ShannonGraphState);
  return {
    actionPlan: result.actionPlan,
    trace: ['node:format'],
  };
}

/**
 * writeback: Scoped memory writeback via ScopedMemoryService.
 * Fire-and-forget — does not block response.
 */
async function writebackNode(state: ShannonStateType): Promise<Partial<ShannonStateType>> {
  const userText = state.envelope.text ?? '';
  const answer = state.finalAnswer ?? '';

  scopedMemory.writeback({
    envelope: state.envelope,
    conversationText: `User: ${userText}\nShannon: ${answer}`,
    exchanges: [
      { role: 'user', content: userText, timestamp: new Date() },
      { role: 'assistant', content: answer, timestamp: new Date() },
    ],
  }).catch(() => {});

  return { trace: ['node:writeback'] };
}

// ---------------------------------------------------------------------------
// Graph construction
// ---------------------------------------------------------------------------

export interface ShannonGraphDeps {
  emotionNode: EmotionNode;
  fca: FunctionCallingAgent;
}

export function buildShannonGraph(deps: ShannonGraphDeps) {
  const workflow = new StateGraph(ShannonState)
    .addNode('ingest', ingestNode)
    .addNode('classify', classifyNodeFn)
    .addNode('minebot_route', minebotRouteNode)
    .addNode('emotion', createEmotionNode(deps.emotionNode))
    .addNode('recall', recallNode)
    .addNode('execute', createExecuteNode(deps.fca, deps.emotionNode))
    .addNode('format', formatNode)
    .addNode('writeback', writebackNode)

    .addEdge(START, 'ingest')
    .addEdge('ingest', 'classify')
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
