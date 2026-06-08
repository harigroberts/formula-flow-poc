import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from './supabase';
import { useWorkflowStore } from '@/store/workflowStore';
import { normalizeDoc } from './persistence';
import type { WorkflowDoc } from '@/types';
import type { RealtimeChannel } from '@supabase/supabase-js';

export type SyncStatus = 'idle' | 'connecting' | 'saving' | 'synced' | 'error';

// Unique per browser tab, survives re-renders but not page reload
const sessionId = (() => {
  const key = 'ff_session_id';
  const hit = sessionStorage.getItem(key);
  if (hit) return hit;
  const id = crypto.randomUUID();
  sessionStorage.setItem(key, id);
  return id;
})();

const WORKFLOW_KEY = 'ff_workflow_id';

export interface SyncAPI {
  status: SyncStatus;
  workflowId: string | null;
  error: string | null;
  remoteBanner: boolean;
  dismissBanner: () => void;
  enableSync: () => Promise<void>;
  disableSync: () => void;
  importById: (id: string) => Promise<void>;
}

export function useSupabaseSync(syncEnabled: boolean): SyncAPI {
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remoteBanner, setRemoteBanner] = useState(false);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref so write closures always see the latest id without being deps
  const workflowIdRef = useRef<string | null>(null);

  const { loadDoc } = useWorkflowStore();

  const dismissBanner = useCallback(() => setRemoteBanner(false), []);

  const teardown = useCallback(() => {
    if (channelRef.current) {
      supabase?.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const handleRemoteUpdate = useCallback(
    (payload: { new: Record<string, unknown> }) => {
      if (payload.new.updated_by === sessionId) return; // echo prevention
      try {
        loadDoc(normalizeDoc(payload.new.doc as WorkflowDoc));
        setRemoteBanner(true);
        setTimeout(() => setRemoteBanner(false), 3000);
        setStatus('synced');
      } catch {
        // malformed remote doc — ignore silently
      }
    },
    [loadDoc]
  );

  const subscribeRealtime = useCallback(
    (id: string) => {
      if (!supabase) return;
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      channelRef.current = supabase
        .channel(`wf-${id}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'workflows',
            filter: `id=eq.${id}`,
          },
          handleRemoteUpdate
        )
        .subscribe();
    },
    [handleRemoteUpdate]
  );

  const flushWrite = useCallback(async (id: string) => {
    if (!supabase) return;
    setStatus('saving');
    try {
      const doc = useWorkflowStore.getState().getDoc();
      const rootFlow = doc.flows.find((f) => f.id === doc.rootFlowId);
      const { error: err } = await supabase
        .from('workflows')
        .update({
          doc: doc as unknown as Record<string, unknown>,
          company_name: rootFlow?.companyName ?? null,
          flow_name: rootFlow?.name ?? 'Untitled',
          updated_by: sessionId,
        })
        .eq('id', id);
      if (err) throw err;
      setStatus('synced');
      setError(null);
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Sync failed');
    }
  }, []);

  // Subscribe to Zustand store and debounce writes while sync is on
  useEffect(() => {
    if (!syncEnabled || !supabase) return;

    const unsub = useWorkflowStore.subscribe(() => {
      const id = workflowIdRef.current;
      if (!id) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => flushWrite(id), 800);
    });

    return () => {
      unsub();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [syncEnabled, flushWrite]);

  const activateWorkflow = useCallback(
    (id: string) => {
      workflowIdRef.current = id;
      setWorkflowId(id);
      subscribeRealtime(id);
      setStatus('synced');
    },
    [subscribeRealtime]
  );

  const enableSync = useCallback(async () => {
    if (!supabase) return;
    setStatus('connecting');
    setError(null);

    try {
      const storedId = localStorage.getItem(WORKFLOW_KEY);

      if (storedId) {
        const { data } = await supabase
          .from('workflows')
          .select('id, doc')
          .eq('id', storedId)
          .single();

        if (data) {
          loadDoc(normalizeDoc(data.doc as WorkflowDoc));
          activateWorkflow(storedId);
          return;
        }
        // Stale key — row no longer exists, fall through to create fresh
        localStorage.removeItem(WORKFLOW_KEY);
      }

      // Insert a new workflow row with the current doc
      const doc = useWorkflowStore.getState().getDoc();
      const rootFlow = doc.flows.find((f) => f.id === doc.rootFlowId);
      const { data: inserted, error: insertErr } = await supabase
        .from('workflows')
        .insert({
          doc: doc as unknown as Record<string, unknown>,
          company_name: rootFlow?.companyName ?? null,
          flow_name: rootFlow?.name ?? 'Untitled',
          updated_by: sessionId,
        })
        .select('id')
        .single();

      if (insertErr || !inserted) throw insertErr ?? new Error('Insert failed');

      localStorage.setItem(WORKFLOW_KEY, inserted.id);
      activateWorkflow(inserted.id);
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Failed to connect');
    }
  }, [loadDoc, activateWorkflow]);

  const disableSync = useCallback(() => {
    teardown();
    workflowIdRef.current = null;
    setStatus('idle');
    setError(null);
  }, [teardown]);

  const importById = useCallback(
    async (id: string) => {
      if (!supabase) return;
      setStatus('connecting');
      setError(null);

      try {
        const { data, error: fetchErr } = await supabase
          .from('workflows')
          .select('*')
          .eq('id', id.trim())
          .single();

        if (fetchErr || !data) throw new Error('Workflow not found');

        loadDoc(normalizeDoc(data.doc as WorkflowDoc));
        localStorage.setItem(WORKFLOW_KEY, id.trim());
        teardown();
        activateWorkflow(id.trim());
      } catch (e) {
        setStatus('error');
        setError(e instanceof Error ? e.message : 'Workflow not found');
      }
    },
    [loadDoc, teardown, activateWorkflow]
  );

  // Cleanup on unmount
  useEffect(() => () => teardown(), [teardown]);

  return {
    status,
    workflowId,
    error,
    remoteBanner,
    dismissBanner,
    enableSync,
    disableSync,
    importById,
  };
}
