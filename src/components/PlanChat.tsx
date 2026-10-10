import { useEffect, useRef } from 'react';
import type { PlanController, PlanProposal } from '@/lib/usePlan';
import { normalizeProposal } from '@/lib/endState';
import type { PlanExchange, PlanTurn } from '@/types';
import chatStyles from './ChatTab.module.css';
import styles from './PlanChat.module.css';

/**
 * The left-hand side of the Plan workspace's Build view: the conversation in which Claude asks
 * what it needs and then proposes the plan. Each proposal shows as a card that opens the end
 * state.
 */

export type ViewMode = 'end' | 'compare';

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function PlanCard({
  proposal,
  latest,
  viewing,
  onView,
}: {
  proposal: PlanProposal;
  latest: boolean;
  viewing: boolean;
  onView: (mode: ViewMode) => void;
}) {
  const p = normalizeProposal(proposal.input);
  const added = p.nodes.filter((n) => n.change === 'new').length;
  const changed = p.nodes.filter((n) => n.change === 'modified').length;
  const removed = p.removedNodeIds.length;
  const automated = p.nodes.filter((n) => n.automation).length;

  return (
    <div className={`${styles.card} ${latest ? '' : styles.cardOld}`}>
      <div className={styles.cardHead}>
        <span className={styles.cardKicker}>
          End state · version {proposal.version}
          {!latest && ' (earlier)'}
          {viewing && ' · on show'}
        </span>
        <span className={styles.cardTitle}>{p.title}</span>
      </div>
      <p className={styles.cardSummary}>{p.summary}</p>
      <div className={styles.cardStats}>
        {automated > 0 && <span>🤖 {automated} automated</span>}
        {added > 0 && <span className={styles.statNew}>+{added} new</span>}
        {changed > 0 && <span className={styles.statChanged}>{changed} changed</span>}
        {removed > 0 && <span className={styles.statRemoved}>−{removed} removed</span>}
        {p.estMonthlyTimeSaved !== undefined && (
          <span>
            ⏱ ~{Math.round(p.estMonthlyTimeSaved / 60)}h/mo saved
          </span>
        )}
      </div>
      <div className={styles.cardActions}>
        <button className="btn-primary" onClick={() => onView('end')}>
          View end state
        </button>
        <button className="btn-secondary" onClick={() => onView('compare')}>
          Compare with original
        </button>
      </div>
    </div>
  );
}

/** One assistant turn: its text as bubbles, its proposal as a card. Tool results aren't shown. */
function AssistantTurn({
  turn,
  plan,
  onView,
}: {
  turn: PlanTurn;
  plan: PlanController;
  onView: (id: string, mode: ViewMode) => void;
}) {
  if (turn.role !== 'assistant') return null;
  const latestId = plan.proposals[plan.proposals.length - 1]?.id;
  return (
    <>
      {turn.content.map((b, i) => {
        if (b.type === 'text') {
          return (
            <div key={i} className={chatStyles.assistantRow}>
              <div className={`${chatStyles.bubble} ${chatStyles.assistant}`}>{b.text}</div>
            </div>
          );
        }
        if (b.type === 'tool_use') {
          const proposal = plan.proposals.find((p) => p.id === b.id);
          return proposal ? (
            <PlanCard
              key={i}
              proposal={proposal}
              latest={proposal.id === latestId}
              viewing={plan.viewing?.id === proposal.id}
              onView={(mode) => onView(proposal.id, mode)}
            />
          ) : (
            <p key={i} className={styles.repairNote}>
              A draft end state didn’t validate and was sent back to be fixed.
            </p>
          );
        }
        return null;
      })}
    </>
  );
}

function ExchangeView({
  ex,
  plan,
  last,
  onView,
}: {
  ex: PlanExchange;
  plan: PlanController;
  last: boolean;
  onView: (id: string, mode: ViewMode) => void;
}) {
  const live = last ? plan.live : null;
  return (
    <>
      <div className={`${chatStyles.bubble} ${chatStyles.user}`}>
        {ex.selectionSent && (
          <span className={styles.selectionChip}>
            ☑ {ex.selectionSent.selected} selected · {ex.selectionSent.notes} note
            {ex.selectionSent.notes === 1 ? '' : 's'}
          </span>
        )}
        {ex.text}
      </div>
      {ex.reply.map((turn, i) => (
        <AssistantTurn key={i} turn={turn} plan={plan} onView={onView} />
      ))}
      {live && (
        <div className={chatStyles.assistantRow}>
          {(live.text || (live.drafting === null && !live.repairing)) && (
            <div className={`${chatStyles.bubble} ${chatStyles.assistant}`}>
              {live.text || <span className={chatStyles.thinking}>Thinking…</span>}
              {live.text && live.drafting === null && <span className={chatStyles.cursor} />}
            </div>
          )}
          {live.drafting !== null && (
            <span className={styles.drafting}>
              <span className={styles.draftingDot} /> Drawing the end-state workflow
              {live.drafting > 0 && ` · ${live.drafting} node${live.drafting === 1 ? '' : 's'}`}…
            </span>
          )}
          {live.repairing && live.drafting === null && !live.text && (
            <span className={styles.drafting}>
              <span className={styles.draftingDot} /> Fixing the end state so it validates…
            </span>
          )}
        </div>
      )}
      {!live && (ex.interrupted || (ex.usage && ex.usage.cacheRead > 0)) && (
        <div className={chatStyles.assistantRow}>
          {ex.interrupted && <span className={chatStyles.meta}>stopped</span>}
          {ex.usage && ex.usage.cacheRead > 0 && (
            <span
              className={chatStyles.meta}
              title={
                `${ex.usage.cacheRead} prompt tokens read from cache · ` +
                `${ex.usage.cacheWrite} written to cache · ${ex.usage.input} uncached`
              }
            >
              context from cache · {formatTokens(ex.usage.cacheRead)} tokens
            </span>
          )}
        </div>
      )}
    </>
  );
}

export default function PlanChat({
  plan,
  onView,
}: {
  plan: PlanController;
  onView: (proposalId: string, mode: ViewMode) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  // Follow the reply as it streams in.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [plan.exchanges, plan.live]);

  const hasSelection = plan.counts.selected + plan.counts.notes > 0;
  const canSend =
    !plan.busy && (!!plan.draft.trim() || (plan.sendsSelection && hasSelection));
  const submit = () => canSend && void plan.send(plan.draft);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className={chatStyles.chat}>
      <div className={chatStyles.messages} ref={listRef}>
        {plan.opening ? (
          <p className={chatStyles.emptyLead}>Opening plan…</p>
        ) : plan.exchanges.length === 0 ? (
          <div className={chatStyles.empty}>
            <p className={chatStyles.emptyLead}>
              Tell Claude what the customer has decided to build. Tick recommendations on the
              right, add notes to change them, or just describe it here — refer to tasks,
              sub-flows and strategy items by name.
            </p>
            <p className={chatStyles.emptyLead}>
              Claude will ask about anything it needs, then propose a plan and draw the end-state
              workflow.
            </p>
          </div>
        ) : (
          plan.exchanges.map((ex, i) => (
            <ExchangeView
              key={i}
              ex={ex}
              plan={plan}
              last={i === plan.exchanges.length - 1}
              onView={onView}
            />
          ))
        )}
      </div>

      {plan.error && <div className={chatStyles.error}>{plan.error}</div>}
      {plan.saveError && <p className={chatStyles.saveWarning}>{plan.saveError}</p>}

      {plan.readOnly ? (
        <div className={chatStyles.readOnly}>
          <p>
            Read only — this plan was made for a different version of the workflow. Its end states
            can still be viewed. Re-run the analysis on that version to continue it, or start a
            new plan here.
          </p>
          <button className="btn-primary" onClick={plan.startSession}>
            Start a new plan
          </button>
        </div>
      ) : (
        <div className={chatStyles.composer}>
          {plan.sendsSelection && plan.exchanges.length > 0 && (
            <p className={styles.selectionNotice}>
              Your selection has changed — it goes with your next message.
            </p>
          )}
          <textarea
            className={chatStyles.input}
            value={plan.draft}
            onChange={(e) => plan.setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Describe what the customer wants to build…  (Shift+Enter for a new line)"
            rows={3}
            disabled={plan.busy}
          />
          <div className={chatStyles.actions}>
            {plan.exchanges.length > 0 && (
              <button
                className="btn-secondary"
                onClick={plan.proposeNow}
                disabled={plan.busy}
                title="Skip any remaining questions — Claude states its assumptions instead"
              >
                Propose plan now
              </button>
            )}
            {plan.busy ? (
              <button className="btn-secondary" onClick={plan.stop}>
                Stop
              </button>
            ) : (
              <button className="btn-primary" onClick={submit} disabled={!canSend}>
                Send
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
