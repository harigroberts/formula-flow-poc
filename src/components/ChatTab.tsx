import { useEffect, useRef } from 'react';
import type { ChatController } from '@/lib/useChat';
import type { ChatMessage } from '@/types';
import styles from './ChatTab.module.css';

/** Static starters — picking one costs nothing until it's sent. */
const SUGGESTIONS = [
  'Which recommendation should we start with, and why?',
  'What is the biggest risk in this plan?',
  'Walk me through the time-saving maths for the top finding.',
];

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function Sidebar({ chat }: { chat: ChatController }) {
  return (
    <aside className={styles.sidebar}>
      <button className={styles.newButton} onClick={chat.newConversation}>
        + New conversation
      </button>

      {chat.persistence === 'no-project' && (
        <p className={styles.sidebarHint}>
          Turn on Cloud Sync to save conversations for this project.
        </p>
      )}

      {chat.persistence === 'on' && chat.conversations.length === 0 && (
        <p className={styles.sidebarHint}>Saved conversations for this project appear here.</p>
      )}

      <ul className={styles.threadList}>
        {chat.conversations.map((c) => (
          <li key={c.id}>
            <button
              className={[
                styles.threadItem,
                c.id === chat.activeId ? styles.threadActive : '',
                c.stale ? styles.threadStale : '',
              ].join(' ')}
              onClick={() => void chat.openConversation(c.id)}
              title={c.stale ? 'About a different version of the workflow — read only' : c.title}
            >
              <span className={styles.threadTitle}>{c.title}</span>
              <span className={styles.threadMeta}>
                {c.stale ? 'different workflow · read only' : formatWhen(c.updatedAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function Message({ m, streaming }: { m: ChatMessage; streaming: boolean }) {
  if (m.role === 'user') {
    return <div className={`${styles.bubble} ${styles.user}`}>{m.content}</div>;
  }

  return (
    <div className={styles.assistantRow}>
      <div className={`${styles.bubble} ${styles.assistant}`}>
        {m.content ||
          // Opus doesn't stream its thinking by default, so this covers the pause before text.
          (streaming && <span className={styles.thinking}>Thinking…</span>)}
        {streaming && m.content && <span className={styles.cursor} />}
      </div>
      {m.interrupted && <span className={styles.meta}>stopped</span>}
      {m.usage && m.usage.cacheRead > 0 && (
        <span
          className={styles.meta}
          title={
            `${m.usage.cacheRead} prompt tokens read from cache · ` +
            `${m.usage.cacheWrite} written to cache · ${m.usage.input} uncached`
          }
        >
          context from cache · {formatTokens(m.usage.cacheRead)} tokens
        </span>
      )}
    </div>
  );
}

export default function ChatTab({ chat }: { chat: ChatController }) {
  const listRef = useRef<HTMLDivElement>(null);
  const { prime, refreshConversations } = chat;

  // The tab only mounts once there's a finished analysis to talk about, so mounting is the
  // signal to cache the workflow prefix ahead of the first message. Idempotent per analysis run.
  useEffect(() => prime(), [prime]);

  // Pick up conversations a collaborator on the same sync ID has saved since.
  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  // Follow the reply as it streams in.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages]);

  const submit = () => void chat.send(chat.draft);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className={styles.layout}>
      <Sidebar chat={chat} />

      <div className={styles.chat}>
        <div className={styles.messages} ref={listRef}>
          {chat.opening ? (
            <p className={styles.emptyLead}>Opening conversation…</p>
          ) : chat.messages.length === 0 ? (
            <div className={styles.empty}>
              <p className={styles.emptyLead}>
                Ask about any of the recommendations — why it was made, what changes if an
                assumption is off, or where to start.
              </p>
              <div className={styles.suggestions}>
                {SUGGESTIONS.map((s) => (
                  <button key={s} className={styles.suggestion} onClick={() => void chat.send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            chat.messages.map((m, i) => (
              <Message key={i} m={m} streaming={chat.busy && i === chat.messages.length - 1} />
            ))
          )}
        </div>

        {chat.error && <div className={styles.error}>{chat.error}</div>}
        {chat.saveError && <p className={styles.saveWarning}>{chat.saveError}</p>}

        {chat.readOnly ? (
          <div className={styles.readOnly}>
            <p>
              Read only — this conversation was about a different version of the workflow. Re-run
              the analysis on that version to continue it, or start a new one here.
            </p>
            <button className="btn-primary" onClick={chat.newConversation}>
              Start a new conversation
            </button>
          </div>
        ) : (
          <div className={styles.composer}>
            <textarea
              className={styles.input}
              value={chat.draft}
              onChange={(e) => chat.setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask about the recommendations…  (Shift+Enter for a new line)"
              rows={2}
              disabled={chat.busy}
            />
            <div className={styles.actions}>
              {chat.busy ? (
                <button className="btn-secondary" onClick={chat.stop}>
                  Stop
                </button>
              ) : (
                <button className="btn-primary" onClick={submit} disabled={!chat.draft.trim()}>
                  Send
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
