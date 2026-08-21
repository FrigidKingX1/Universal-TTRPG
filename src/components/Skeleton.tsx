import "../App.css";

export function SkeletonText({ lines = 3, width = "100%" }: { lines?: number; width?: string }) {
  return (
    <div style={{ width }} className="skeleton-text" role="status" aria-label="Loading content">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton-line" style={{ width: i === lines - 1 ? "70%" : "100%" }} />
      ))}
    </div>
  );
}

export function SkeletonCard({ lines = 4 }: { lines?: number }) {
  return (
    <div className="skeleton-card" role="status" aria-label="Loading card">
      <div className="skeleton-avatar" />
      <SkeletonText lines={lines} />
    </div>
  );
}

export function SkeletonList({ count = 5, lines = 2 }: { count?: number; lines?: number }) {
  return (
    <div className="skeleton-list" role="status" aria-label="Loading list">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-list-item">
          <div className="skeleton-avatar" />
          <SkeletonText lines={lines} width="80%" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="skeleton-table" role="status" aria-label="Loading table">
      <div className="skeleton-table-header">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="skeleton-cell" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div key={rowIdx} className="skeleton-table-row">
          {Array.from({ length: cols }).map((_, colIdx) => (
            <div key={colIdx} className="skeleton-cell" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonPanel({ title = true, contentLines = 6 }: { title?: boolean; contentLines?: number }) {
  return (
    <div className="skeleton-panel" role="status" aria-label="Loading panel">
      {title && <div className="skeleton-title" />}
      <SkeletonText lines={contentLines} />
    </div>
  );
}