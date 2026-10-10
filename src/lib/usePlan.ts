import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildChatContext } from '@/lib/chat';
import { workflowHash } from '@/lib/conversations';
import { PROPOSE_TOOL, toEndStateDoc } from '@/lib/endState';
import { primePlan, streamPlan } from '@/lib/plan';
import {
  SELECTION_PREFIX,
  allNodes,
  applyCheck,
  buildPlanTree,
  selectionBlock,
  selectionCounts,
  selectionPayload,
} from '@/lib/planSelection';
import {
  createPlanSession,
  listPlanSessions,
  loadPlanSession,
  savePlanSession,
} from '@/lib/planSessions';
import { supabaseConfigured } from '@/lib/supabase';
import type { AnalysisStage } from '@/lib/analysisRunner';
import type {
  ChatContext,
  EndStateProposal,
  MultiLevelAnalysis,
  PlanExchange,
  PlanSessionSummary,
  PlanTurn,
  SelectionState,
  WorkflowDoc,
} from '@/types';

export type PlanController = ReturnType<typeof usePlan>;

/** The session on screen. */
interface Session {
  /** Also the row id once saved — assigned up front so no save ever waits on the insert. */
  id: string;
  /** What the thread's prompt is built on: the current analysis, or a saved session's own. */
  context: ChatContext;
  /** The full doc that analysis ran on — the original side of Compare, and the layout source. */
  sourceDoc: WorkflowDoc;
  /** The saved workflow hash of an opened session; null for one started now. */
  hash: string | null;
}

/** A proposal that passed validation, as it appears in the thread. */
export interface PlanProposal {
  id: string;
  input: EndStateProposal;
  /** 1-based, in thread order. */
  version: number;
}

/** The reply in flight. */
interface Live {
  text: string;
  /** Nodes drafted so far while the end state is being written; null when it isn't. */
  drafting: number | null;
  repairing: boolean;
}

const DEFAULT_TEXT = 'Here is what the customer has selected.';
const PROPOSE_NOW =
  'Go ahead and propose the plan now. State your assumptions for anything still open.';
const SELECTION_SAVE_DELAY = 800;

const newSession = (context: ChatContext, sourceDoc: WorkflowDoc): Session => ({
  id: crypto.randomUUID(),
  context,
  sourceDoc,
  hash: null,
});

const historyOf = (exchanges: PlanExchange[]): PlanTurn[] =>
  exchanges.flatMap((e) => [e.user, ...e.reply]);

/** The first message, on one line, short enough for the sessions rail. */
function titleOf(exchanges: PlanExchange[]): string {
  const first = exchanges[0]?.text.replace(/\s+/g, ' ').trim() ?? '';
  return first.length > 80 ? `${first.slice(0, 79)}…` : first || 'Plan';
}

/** Valid proposals in thread order: a tool call whose result didn't come back as an error. */
function proposalsOf(exchanges: PlanExchange[]): PlanProposal[] {
  const turns = historyOf(exchanges);
  const failed = new Set(
    turns.flatMap((t) =>
      t.content.flatMap((b) => (b.type === 'tool_result' && b.is_error ? [b.tool_use_id] : [])),
    ),
  );
  const answered = new Set(
    turns.flatMap((t) => t.content.flatMap((b) => (b.type === 'tool_result' ? [b.tool_use_id] : []))),
  );
  const out: PlanProposal[] = [];
  for (const t of turns) {
    for (const b of t.content) {
      if (b.type === 'tool_use' && b.name === PROPOSE_TOOL && answered.has(b.id) && !failed.has(b.id)) {
        out.push({ id: b.id, input: b.input, version: out.length + 1 });
      }
    }
  }
  return out;
}

/** The selection block the thread last sent, so an unchanged selection isn't re-sent. */
function lastSentSelection(exchanges: PlanExchange[]): string | null {
  for (let i = exchanges.length - 1; i >= 0; i--) {
    const first = exchanges[i].user.content[0];
    if (first?.type === 'text' && first.text.startsWith(SELECTION_PREFIX)) return first.text;
  }
  return null;
}

/**
 * A reply cut short still has to leave a history that ends on an assistant turn: the finished
 * turns the server sent, then whatever text was streaming. Empty means nothing worth keeping.
 */
function closeReply(reply: PlanTurn[], pending: string): PlanTurn[] {
  const turns = [...reply];
  const last = turns[turns.length - 1];
  if (last?.role === 'assistant') return turns;
  if (pending.trim()) return [...turns, { role: 'assistant', content: [{ type: 'text', text: pending }] }];
  if (last?.role === 'user') {
    return [...turns, { role: 'assistant', content: [{ type: 'text', text: '[Stopped.]' }] }];
  }
  return turns;
}

/**
 * Owns the Plan workspace: the session on screen (its thread, its recommendations-tree
 * selection, the end states it has proposed) and the project's saved sessions. Lives in `App`
 * beside `useChat` so a session survives closing the workspace, and — like the analysis —
 * stays out of the Zustand store: nothing here reaches the synced or exported `WorkflowDoc`.
 *
 * `projectId` is the sync ID. Without one, planning still works but nothing is saved.
 *
 * A saved session is read-only once its workflow hash differs from the workflow the current
 * analysis ran on; its end states stay viewable. Matching ones reopen against their own stored
 * context and source doc.
 */
export function usePlan(
  analysedDoc: WorkflowDoc | null,
  analysis: MultiLevelAnalysis | null,
  stage: AnalysisStage,
  analysisError: string | null,
  projectId: string | null,
) {
  const context = useMemo<ChatContext | null>(
    () =>
      analysedDoc && analysis?.tasks && stage === 'done' && !analysisError
        ? buildChatContext(analysedDoc, analysis)
        : null,
    [analysedDoc, analysis, stage, analysisError],
  );

  const [currentHash, setCurrentHash] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [exchanges, setExchanges] = useState<PlanExchange[]>([]);
  const [selection, setSelection] = useState<SelectionState>({});
  const [live, setLive] = useState<Live | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sessions, setSessions] = useState<PlanSessionSummary[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** The proposal on show; null follows the latest. */
  const [viewingId, setViewingId] = useState<string | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  const projectRef = useRef(projectId);
  const abortRef = useRef<AbortController | null>(null);
  const primeRef = useRef<{ context: ChatContext; promise: Promise<void> } | null>(null);
  /** Sessions that already have a row, so the next save updates rather than inserts. */
  const savedIds = useRef(new Set<string>());
  /** Saves run one at a time, so a quick second save can't overtake the insert. */
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  /** Skips the debounced selection save when the selection was loaded rather than edited. */
  const selectionLoaded = useRef(false);
  /** The selection now — saves queued earlier read it when they run. */
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const busy = live !== null;

  const showSession = useCallback(
    (next: Session | null, nextExchanges: PlanExchange[] = [], nextSelection: SelectionState = {}) => {
      abortRef.current?.abort();
      abortRef.current = null;
      sessionIdRef.current = next?.id ?? null;
      selectionLoaded.current = true;
      setSession(next);
      setExchanges(nextExchanges);
      setSelection(nextSelection);
      setLive(null);
      setOpening(false);
      setError(null);
      setSaveError(null);
      setViewingId(null);
    },
    [],
  );

  // Fingerprint of the workflow the current analysis ran on — what "same workflow" means.
  useEffect(() => {
    setCurrentHash(null);
    if (!context) return;
    let alive = true;
    void workflowHash(context.workflow).then((h) => alive && setCurrentHash(h));
    return () => {
      alive = false;
    };
  }, [context]);

  // A new analysis run starts a new session over it.
  useEffect(() => {
    primeRef.current = null;
    showSession(context && analysedDoc ? newSession(context, analysedDoc) : null);
  }, [context, analysedDoc, showSession]);

  // Switching project leaves a saved session behind — it belongs to the old project. An unsaved
  // one carries over, so turning sync on mid-plan saves it on its next reply.
  useEffect(() => {
    projectRef.current = projectId;
    const id = sessionIdRef.current;
    if (context && analysedDoc && id && savedIds.current.has(id)) {
      showSession(newSession(context, analysedDoc));
    }
  }, [projectId, context, analysedDoc, showSession]);

  const refreshSessions = useCallback(async () => {
    const pid = projectId;
    if (!pid) {
      setSessions([]);
      return;
    }
    try {
      const list = await listPlanSessions(pid);
      if (projectRef.current === pid) setSessions(list);
    } catch (err) {
      console.warn('[plan] could not load sessions:', err);
    }
  }, [projectId]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  /**
   * Caches the tool, system and workflow prefix before the user sends anything. Once per
   * analysis run; a failed prime isn't surfaced — the first turn simply writes it itself.
   */
  const prime = useCallback(() => {
    if (!context || primeRef.current?.context === context) return;
    primeRef.current = {
      context,
      promise: primePlan(context).catch((err) => console.warn('[plan] prime failed:', err)),
    };
  }, [context]);

  const readOnly = session?.hash != null && session.hash !== currentHash;

  const tree = useMemo(
    () => (session ? buildPlanTree(session.sourceDoc, session.context.analysis) : null),
    [session],
  );
  const payload = useMemo(() => selectionPayload(tree, selection), [tree, selection]);
  const block = useMemo(() => selectionBlock(payload), [payload]);
  const counts = useMemo(() => selectionCounts(payload), [payload]);
  const selectionChanged = block !== lastSentSelection(exchanges);
  /** The first send always carries the selection, even an empty one: it fixes the scope. */
  const sendsSelection = exchanges.length === 0 || selectionChanged;

  const proposals = useMemo(() => proposalsOf(exchanges), [exchanges]);
  const viewing = proposals.find((p) => p.id === viewingId) ?? proposals[proposals.length - 1] ?? null;
  const endState = useMemo(
    () => (viewing && session ? toEndStateDoc(viewing.input, session.sourceDoc) : null),
    [viewing, session],
  );
  /** Leaf ids the proposal on show says it delivers. */
  const implemented = useMemo(
    () => new Set(endState?.proposal.nodes.flatMap((n) => n.automation?.implements ?? []) ?? []),
    [endState],
  );
  const leafNames = useMemo(
    () => new Map(tree ? allNodes(tree).map((n) => [n.id, n.label]) : []),
    [tree],
  );

  // A new proposal landing takes over the view.
  const proposalCount = proposals.length;
  useEffect(() => setViewingId(null), [proposalCount]);

  const persist = useCallback(
    (s: Session, all: PlanExchange[], sel: SelectionState) => {
      const pid = projectId;
      if (!pid || !supabaseConfigured) return;
      const planTitle = proposalsOf(all).slice(-1)[0]?.input.title ?? null;

      saveChain.current = saveChain.current.then(async () => {
        // The selection as it is when the save actually runs, while the session is still on
        // screen — ticks made while a reply streamed or an insert was in flight count too.
        const latest = sessionIdRef.current === s.id ? selectionRef.current : sel;
        try {
          const summary = savedIds.current.has(s.id)
            ? await savePlanSession(s.id, { exchanges: all, selection: latest, planTitle })
            : await createPlanSession({
                id: s.id,
                projectId: pid,
                workflowHash: s.hash ?? (await workflowHash(s.context.workflow)),
                title: titleOf(all),
                planTitle,
                context: s.context,
                sourceDoc: s.sourceDoc,
                selection: latest,
                exchanges: all,
              });
          savedIds.current.add(s.id);
          setSaveError(null);
          if (projectRef.current === pid) {
            setSessions((list) => [summary, ...list.filter((c) => c.id !== summary.id)]);
          }
        } catch (err) {
          // Never breaks planning. A failed insert is simply retried on the next reply.
          console.warn('[plan] save failed:', err);
          setSaveError('Couldn’t save this plan — it will retry after the next reply.');
        }
      });
    },
    [projectId],
  );

  // Ticks and notes save on their own once the session has a row, so annotating without
  // sending isn't lost. Queued behind any save in flight — the row may still be being inserted —
  // and skipped if there's still no row then: the first reply's insert carries the selection.
  useEffect(() => {
    if (selectionLoaded.current) {
      selectionLoaded.current = false;
      return;
    }
    const s = session;
    if (!s || readOnly || !projectId || !supabaseConfigured) return;
    const timer = setTimeout(() => {
      saveChain.current = saveChain.current.then(async () => {
        if (!savedIds.current.has(s.id) || sessionIdRef.current !== s.id) return;
        try {
          await savePlanSession(s.id, { selection: selectionRef.current });
        } catch (err) {
          console.warn('[plan] selection save failed:', err);
        }
      });
    }, SELECTION_SAVE_DELAY);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  /** Ticks or clears a row and everything under it; sub-flows above it re-derive. */
  const toggle = useCallback(
    (id: string, checked: boolean) => {
      if (tree) setSelection((sel) => applyCheck(tree, sel, id, checked));
    },
    [tree],
  );

  const setNotes = useCallback((id: string, notes: string) => {
    setSelection((sel) => ({ ...sel, [id]: { checked: sel[id]?.checked ?? false, notes } }));
  }, []);

  const clearSelection = useCallback(() => setSelection({}), []);

  const updateLast = (patch: Partial<PlanExchange>) =>
    setExchanges((ex) => [...ex.slice(0, -1), { ...ex[ex.length - 1], ...patch }]);

  /**
   * `proposeNow` appends the "go ahead" instruction to whatever was typed, so text in the
   * composer is never dropped by asking for the plan.
   */
  const send = useCallback(
    async (raw: string, { proposeNow = false } = {}) => {
      const typed = raw.trim();
      const s = session;
      if (!s || readOnly || busy || opening || (!typed && !sendsSelection && !proposeNow)) return;

      const text = proposeNow
        ? [typed, PROPOSE_NOW].filter(Boolean).join('\n\n')
        : typed || DEFAULT_TEXT;
      const exchange: PlanExchange = {
        user: {
          role: 'user',
          content: [
            ...(sendsSelection ? [{ type: 'text' as const, text: block }] : []),
            { type: 'text', text },
          ],
        },
        text,
        ...(sendsSelection && { selectionSent: counts }),
        reply: [],
      };
      const before = exchanges;
      const sel = selection;

      setError(null);
      setDraft('');
      setExchanges([...before, exchange]);
      setLive({ text: '', drafting: null, repairing: false });

      const controller = new AbortController();
      abortRef.current = controller;
      const reply: PlanTurn[] = [];
      let pending = '';

      try {
        // A cache entry only becomes readable once the request writing it has responded.
        await primeRef.current?.promise;

        const usage = await streamPlan(
          s.context,
          historyOf([...before, exchange]),
          {
            onText: (delta) => {
              pending += delta;
              setLive((l) => l && { ...l, text: pending });
            },
            onDrafting: (nodes) => setLive((l) => l && { ...l, drafting: nodes }),
            onRepairing: () => setLive((l) => l && { ...l, repairing: true }),
            onTurns: (turns) => {
              reply.push(...turns);
              pending = '';
              updateLast({ reply: [...reply] });
              setLive((l) => l && { ...l, text: '', drafting: null });
            },
          },
          controller.signal,
        );
        const done: PlanExchange = { ...exchange, reply: [...reply], usage };
        updateLast(done);
        persist(s, [...before, done], sel);
      } catch (err) {
        // Keep the finished turns and whatever text was streaming — saved even if the user has
        // switched session meanwhile, which is what aborted it. With nothing to keep, the
        // exchange is dropped so the history still alternates.
        const kept = closeReply(reply, pending);
        const partial: PlanExchange | null = kept.length
          ? { ...exchange, reply: kept, interrupted: true }
          : null;
        if (partial) persist(s, [...before, partial], sel);

        if (sessionIdRef.current !== s.id) return; // no longer on screen

        if (partial) {
          updateLast(partial);
        } else {
          setExchanges(before);
          setDraft(typed);
        }
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Planning failed');
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setLive(null);
        }
      }
    },
    [session, readOnly, busy, opening, sendsSelection, block, counts, exchanges, selection, persist],
  );

  const proposeNow = useCallback(() => void send(draft, { proposeNow: true }), [send, draft]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const startSession = useCallback(() => {
    if (context && analysedDoc) showSession(newSession(context, analysedDoc));
  }, [context, analysedDoc, showSession]);

  const openSession = useCallback(
    async (id: string) => {
      if (id === sessionIdRef.current) return;
      const summary = sessions.find((c) => c.id === id);
      if (!summary) return;

      showSession(null);
      sessionIdRef.current = id;
      setOpening(true);
      try {
        const saved = await loadPlanSession(id);
        if (sessionIdRef.current !== id) return; // another click won
        savedIds.current.add(id);
        showSession(
          { id, context: saved.context, sourceDoc: saved.sourceDoc, hash: summary.workflowHash },
          saved.exchanges,
          saved.selection,
        );
      } catch (err) {
        if (sessionIdRef.current !== id) return;
        setOpening(false);
        setError(err instanceof Error ? err.message : 'Could not open that plan');
      }
    },
    [sessions, showSession],
  );

  return {
    /** False until an analysis has finished without error. */
    available: context !== null,
    sourceDoc: session?.sourceDoc ?? null,
    exchanges,
    live,
    busy,
    opening,
    error,
    draft,
    setDraft,
    prime,
    send,
    proposeNow,
    stop,
    /** The session on screen was about a different version of the workflow. */
    readOnly,

    tree,
    selection,
    toggle,
    setNotes,
    clearSelection,
    /** Ticked / annotated leaves in the current selection. */
    counts,
    /** The next send will carry the selection block. */
    sendsSelection,
    selectionChanged,

    proposals,
    viewing,
    viewProposal: setViewingId,
    /** The proposal on show as a renderable doc, with the diff maps for both views. */
    endState,
    implemented,
    leafNames,

    activeId: session?.id ?? null,
    /** `stale`: about a different workflow than the current analysis — shown red, read-only. */
    sessions: sessions.map((c) => ({
      ...c,
      stale: currentHash !== null && c.workflowHash !== currentHash,
    })),
    /** `off`: Supabase isn't configured. `no-project`: sync is off, so there's no ID to save under. */
    persistence: !supabaseConfigured ? 'off' : projectId ? 'on' : 'no-project',
    saveError,
    startSession,
    openSession,
    refreshSessions,
  } as const;
}
