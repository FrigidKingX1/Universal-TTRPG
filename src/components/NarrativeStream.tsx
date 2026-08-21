import { useState, useRef, useEffect, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ScrollText, RefreshCw, Send } from "lucide-react";
import { useStore } from "../store";
import type { StoryLogEntry } from "../types";
import "../App.css";

const SPEAKER_COLORS: Record<string, string> = {
  "Dungeon Master": "var(--accent)",
  "Player": "var(--success)",
  "Oracle": "var(--warning)",
  "System": "var(--info)",
  "Narrator": "var(--accent)",
};

function getSpeakerColor(speaker: string): string {
  return SPEAKER_COLORS[speaker] ?? "var(--color-muted)";
}

function getRoleColor(role: StoryLogEntry["role"]): string {
  switch (role) {
    case "player": return "var(--success)";
    case "narrator": return "var(--accent)";
    case "npc": return "var(--info)";
    case "system": return "var(--muted)";
    case "combat": return "var(--danger)";
    case "auto-dm": return "var(--accent)";
    default: return "var(--muted)";
  }
}

export function NarrativeStream() {
  const storyLog = useStore((s) => s.storyLog);
  const dmIntent = useStore((s) => s.dmIntent);
  const activeScene = useStore((s) =>
    s.scenes.find((sc) => sc.id === s.activeSceneId),
  );
  const processDmIntent = useStore((s) => s.processDmIntent);
  const refreshLogs = useStore((s) => s.refreshLogs);
  const showToast = useStore((s) => s.showToast);

  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: storyLog.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 88,
    overscan: 8,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  useEffect(() => {
    if (scrollContainerRef.current) {
      // For small histories, keep the classic auto-scroll; for virtualized
      // histories, scroll the virtualizer to the last item.
      if (storyLog.length > 30) {
        rowVirtualizer.scrollToIndex(storyLog.length - 1, { align: "end" });
      } else {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      }
    }
  }, [storyLog, dmIntent.streamingText]);

  useEffect(() => {
    void refreshLogs();
  }, [refreshLogs]);

  const handleSubmit = useCallback(async () => {
    if (!inputValue.trim() || dmIntent.loading) return;
    const userInput = inputValue.trim();
    setInputValue("");

    try {
      await processDmIntent(userInput);
    } catch (e) {
      showToast(String(e));
    }
  }, [inputValue, dmIntent.loading, processDmIntent, showToast]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleRefresh = useCallback(() => {
    void refreshLogs();
  }, [refreshLogs]);

  return (
    <main className="panel narrative-stream" role="main" aria-label="Narrative Stream">
      <div className="panel-header">
        <span className="panel-icon" aria-hidden="true"><ScrollText size={16} strokeWidth={1.7} /></span>
        <span className="panel-title">
          {activeScene ? activeScene.title : "Narrative Stream"}
        </span>
        <button
          className="icon-btn icon-btn-small"
          onClick={handleRefresh}
          title="Refresh logs"
          aria-label="Refresh logs"
        >
          <RefreshCw size={14} strokeWidth={1.8} />
        </button>
      </div>

      <div className="narrative-content" ref={scrollContainerRef} aria-live="polite" aria-atomic="false">
        {storyLog.length === 0 ? (
          <div className="fantasy-empty" role="status">
            <span className="fantasy-empty-icon" aria-hidden="true">📜</span>
            <span>No tale yet — speak your first action below.</span>
            <span className="rune-divider" aria-hidden="true">◆ — ◇ — ◆</span>
          </div>
        ) : storyLog.length > 30 ? (
          <div
            style={{
              height: `${totalSize}px`,
              width: "100%",
              position: "relative",
            }}
            role="log"
            aria-label="Story log"
          >
            {virtualItems.map((virtualRow) => {
              const entry = storyLog[virtualRow.index];
              return (
                <div
                  key={entry.id}
                  className="story-entry"
                  data-speaker={entry.speaker}
                  data-role={entry.role}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div
                    className="story-speaker"
                    style={{ color: getSpeakerColor(entry.speaker) }}
                    aria-label={`Speaker: ${entry.speaker}`}
                  >
                    {entry.speaker}
                  </div>
                  <div className="story-content">{entry.content}</div>
                  <div className="story-meta">
                    <span
                      className="story-role"
                      style={{ color: getRoleColor(entry.role) }}
                      aria-label={`Role: ${entry.role}`}
                    >
                      {entry.role}
                    </span>
                    <time className="story-time" dateTime={entry.timestamp}>
                      {new Date(entry.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="story-log" role="log" aria-label="Story log">
            {storyLog.map((entry) => (
              <div
                key={entry.id}
                className="story-entry"
                data-speaker={entry.speaker}
                data-role={entry.role}
              >
                <div
                  className="story-speaker"
                  style={{ color: getSpeakerColor(entry.speaker) }}
                  aria-label={`Speaker: ${entry.speaker}`}
                >
                  {entry.speaker}
                </div>
                <div className="story-content">{entry.content}</div>
                <div className="story-meta">
                  <span
                    className="story-role"
                    style={{ color: getRoleColor(entry.role) }}
                    aria-label={`Role: ${entry.role}`}
                  >
                    {entry.role}
                  </span>
                  <time className="story-time" dateTime={entry.timestamp}>
                    {new Date(entry.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
              </div>
            ))}
          </div>
        )}

        {dmIntent.loading && (
          <div className="dm-loading" role="status" aria-live="assertive">
            {dmIntent.streamingText ? (
              <div className="streaming-narrative">
                <div className="story-speaker" style={{ color: getSpeakerColor("Dungeon Master") }}>
                  Dungeon Master
                </div>
                <div className="story-content">{dmIntent.streamingText}</div>
                <span className="streaming-cursor" aria-hidden="true">▊</span>
              </div>
            ) : (
              <>
                <div className="spinner" aria-label="Dungeon Master is thinking" />
                <span>The Dungeon Master ponders your action…</span>
              </>
            )}
          </div>
        )}

        {dmIntent.lastResponse && (
          <div className="dm-response">
            {dmIntent.lastResponse.mechanical_events.length > 0 && (
              <details className="mechanical-events">
                <summary>Mechanical Events</summary>
                <ul>
                  {dmIntent.lastResponse.mechanical_events.map((event, i) => (
                    <li key={i}>{event}</li>
                  ))}
                </ul>
              </details>
            )}
            {dmIntent.lastResponse.fate_interpretation && (
              <div className="fate-interpretation" aria-label="Oracle interpretation">
                Oracle: {dmIntent.lastResponse.fate_interpretation}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="input-dock" role="form" aria-label="Player action input">
        <label htmlFor="dm-input" className="visually-hidden">
          Describe your action or ask the DM a question
        </label>
        <textarea
          ref={inputRef}
          id="dm-input"
          className="dm-input"
          placeholder="Describe your action or ask the DM a question… (Enter to send, Shift+Enter for newline)"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={dmIntent.loading}
          rows={2}
          maxLength={1000}
          aria-describedby="input-hint"
        />
        <span id="input-hint" className="visually-hidden">
          Press Enter to send, Shift+Enter for newline
        </span>
        <button
          className="btn btn-primary btn-send"
          onClick={handleSubmit}
          disabled={dmIntent.loading || !inputValue.trim()}
          aria-label="Send action to DM"
          aria-disabled={dmIntent.loading || !inputValue.trim()}
        >
          <Send size={16} strokeWidth={1.8} />
        </button>
      </div>
    </main>
  );
}
