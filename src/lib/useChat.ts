import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildChatContext, primeChat, streamChat } from '@/lib/chat';
import {
  createConversation,
  listConversations,
  loadConversation,
  saveMessages,
  workflowHash,
} from '@/lib/conversations';
import { supabaseConfigured } from '@/lib/supabase';
import type { AnalysisStage } from '@/lib/analysisRunner';
import type {
  ChatContext,
  ChatMessage,
  ChatTurn,
  ConversationSummary,
  MultiLevelAnalysis,
  WorkflowDoc,
} from '@/types';

export type ChatController = ReturnType<typeof useChat>;

/** The conversation on screen. */
interface Thread {
  /** Also the row id once saved — assigned up front so no save ever waits on the insert. */
  id: string;
  /** What this thread's prompt is built on: the current analysis, or a saved conversation's own. */
  context: ChatContext;
  /** The saved workflow hash of an opened conversation; null for a thread started now. */
  hash: string | null;
}

const newThread = (context: ChatContext): Thread => ({
  id: crypto.randomUUID(),
  context,
  hash: null,
});

/** The first user message, on one line, short enough for the sidebar. */
function titleOf(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === 'user')?.content.replace(/\s+/g, ' ').trim() ?? '';
  return first.length > 80 ? `${first.slice(0, 79)}…` : first || 'Conversation';
}

/**
 * Owns the chat about the analysis: the thread on screen and the project's saved
 * conversations. Lives in `App` next to `useAnalysis` so it survives closing the panel, and —
 * like the analysis — stays out of the Zustand store, so none of it reaches the synced or
 * exported `WorkflowDoc`.
 *
 * `projectId` is the sync ID. Without one, chat still works but nothing is saved.
 *
 * A saved conversation is read-only once its workflow hash differs from the workflow the
 * current analysis ran on: its history is about a graph that no longer exists. Matching ones
 * reopen against their own stored context, so they carry on with the analysis they discussed.
 */
export function useChat(
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
  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [opening, setOpening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  const threadIdRef = useRef<string | null>(null);
  const projectRef = useRef(projectId);
  const abortRef = useRef<AbortController | null>(null);
  const primeRef = useRef<{ context: ChatContext; promise: Promise<void> } | null>(null);
  /** Threads that already have a row, so the next save updates rather than inserts. */
  const savedIds = useRef(new Set<string>());
  /** Saves run one at a time, so a quick second turn can't update a row still being inserted. */
  const saveChain = useRef<Promise<void>>(Promise.resolve());

  const showThread = useCallback((next: Thread | null, nextMessages: ChatMessage[] = []) => {
    abortRef.current?.abort();
    abortRef.current = null;
    threadIdRef.current = next?.id ?? null;
    setThread(next);
    setMessages(nextMessages);
    setOpening(false);
    setBusy(false);
    setError(null);
    setSaveError(null);
  }, []);

  // Fingerprint of the workflow the current analysis ran on — what "same workflow" means.
  useEffect(() => {
    setCurrentHash(null);
    if (!context) return;
    let live = true;
    void workflowHash(context.workflow).then((h) => live && setCurrentHash(h));
    return () => {
      live = false;
    };
  }, [context]);

  // A new analysis run starts a new conversation over it.
  useEffect(() => {
    primeRef.current = null;
    showThread(context ? newThread(context) : null);
  }, [context, showThread]);

  // Switching project (another sync ID imported, or sync turned off) leaves a saved
  // conversation behind — it belongs to the old project. An unsaved one carries over, so
  // turning sync on mid-chat saves the whole thread on its next reply.
  useEffect(() => {
    projectRef.current = projectId;
    const id = threadIdRef.current;
    if (context && id && savedIds.current.has(id)) showThread(newThread(context));
  }, [projectId, context, showThread]);

  const refreshConversations = useCallback(async () => {
    const pid = projectId;
    if (!pid) {
      setConversations([]);
      return;
    }
    try {
      const list = await listConversations(pid);
      if (projectRef.current === pid) setConversations(list);
    } catch (err) {
      console.warn('[chat] could not load conversations:', err);
    }
  }, [projectId]);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  /**
   * Caches the workflow prefix before the user has typed anything. Once per analysis run. Every
   * conversation whose hash matches shares this workflow turn byte for byte, so it warms those
   * too. A failed prime isn't surfaced: the first turn simply writes that part itself.
   */
  const prime = useCallback(() => {
    if (!context || primeRef.current?.context === context) return;
    primeRef.current = {
      context,
      promise: primeChat(context).catch((err) => console.warn('[chat] prime failed:', err)),
    };
  }, [context]);

  const readOnly = thread?.hash != null && thread.hash !== currentHash;

  const persist = useCallback(
    (t: Thread, all: ChatMessage[]) => {
      const pid = projectId;
      if (!pid || !supabaseConfigured) return;

      saveChain.current = saveChain.current.then(async () => {
        try {
          const summary = savedIds.current.has(t.id)
            ? await saveMessages(t.id, all)
            : await createConversation({
                id: t.id,
                projectId: pid,
                workflowHash: t.hash ?? (await workflowHash(t.context.workflow)),
                title: titleOf(all),
                context: t.context,
                messages: all,
              });
          savedIds.current.add(t.id);
          setSaveError(null);
          if (projectRef.current === pid) {
            setConversations((list) => [summary, ...list.filter((c) => c.id !== summary.id)]);
          }
        } catch (err) {
          // Never breaks the chat. An insert that failed is simply retried on the next turn.
          console.warn('[chat] save failed:', err);
          setSaveError('Couldn’t save this conversation — it will retry after the next reply.');
        }
      });
    },
    [projectId],
  );

  const updateLast = (patch: Partial<ChatMessage>) =>
    setMessages((m) => [...m.slice(0, -1), { ...m[m.length - 1], ...patch }]);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      const t = thread;
      if (!text || !t || readOnly || busy || opening) return;

      const userMessage: ChatMessage = { role: 'user', content: text };
      const history: ChatTurn[] = [
        ...messages.map(({ role, content }) => ({ role, content })),
        userMessage,
      ];

      setError(null);
      setDraft('');
      setMessages([...messages, userMessage, { role: 'assistant', content: '' }]);
      setBusy(true);

      const controller = new AbortController();
      abortRef.current = controller;
      let reply = '';

      try {
        // A cache entry only becomes readable once the request writing it has responded, so
        // a message sent while the prime is still in flight would miss it.
        await primeRef.current?.promise;

        const usage = await streamChat(
          t.context,
          history,
          (delta) => {
            reply += delta;
            updateLast({ content: reply });
          },
          controller.signal,
        );
        const done: ChatMessage = { role: 'assistant', content: reply, usage };
        updateLast(done);
        persist(t, [...messages, userMessage, done]);
      } catch (err) {
        // Keep whatever arrived — saved even if the user has switched conversation meanwhile,
        // which is what aborted it. With nothing to keep, the turn is dropped so the history
        // still alternates.
        const partial: ChatMessage | null = reply.trim()
          ? { role: 'assistant', content: reply, interrupted: true }
          : null;
        if (partial) persist(t, [...messages, userMessage, partial]);

        if (threadIdRef.current !== t.id) return; // no longer on screen

        if (partial) {
          updateLast(partial);
        } else {
          setMessages(messages);
          setDraft(text);
        }
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Chat failed');
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setBusy(false);
        }
      }
    },
    [thread, readOnly, busy, opening, messages, persist],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const newConversation = useCallback(() => {
    if (context) showThread(newThread(context));
  }, [context, showThread]);

  const openConversation = useCallback(
    async (id: string) => {
      if (id === threadIdRef.current) return;
      const summary = conversations.find((c) => c.id === id);
      if (!summary) return;

      showThread(null);
      threadIdRef.current = id;
      setOpening(true);
      try {
        const saved = await loadConversation(id);
        if (threadIdRef.current !== id) return; // another click won
        savedIds.current.add(id);
        showThread({ id, context: saved.context, hash: summary.workflowHash }, saved.messages);
      } catch (err) {
        if (threadIdRef.current !== id) return;
        setOpening(false);
        setError(err instanceof Error ? err.message : 'Could not open that conversation');
      }
    },
    [conversations, showThread],
  );

  return {
    /** False until an analysis has finished without error. */
    available: context !== null,
    messages,
    busy,
    opening,
    error,
    draft,
    setDraft,
    prime,
    send,
    stop,
    activeId: thread?.id ?? null,
    /** The conversation on screen was about a different version of the workflow. */
    readOnly,
    /** `stale`: about a different workflow than the current analysis — shown red, read-only. */
    conversations: conversations.map((c) => ({
      ...c,
      stale: currentHash !== null && c.workflowHash !== currentHash,
    })),
    /** `off`: Supabase isn't configured. `no-project`: sync is off, so there's no ID to save under. */
    persistence: !supabaseConfigured ? 'off' : projectId ? 'on' : 'no-project',
    saveError,
    newConversation,
    openConversation,
    refreshConversations,
  } as const;
}
