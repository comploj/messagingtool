import React, { useState, useEffect, useRef, useCallback } from 'react';
import { fetchShare } from '../utils/apiClient';

// Public, read-only view of a project's Sequences tab.
// No auth required. No editing controls. No prompt templates exposed.
export default function ShareView({ token }) {
  const [state, setState] = useState({ loading: true, error: null, snap: null });
  const wrapperRef = useRef(null);
  const stickyScrollRef = useRef(null);
  const scrollInnerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await fetchShare(token);
        if (cancelled) return;
        if (!snap) {
          setState({ loading: false, error: 'not_found', snap: null });
        } else {
          setState({ loading: false, error: null, snap });
        }
      } catch (err) {
        if (cancelled) return;
        setState({ loading: false, error: err.message || 'unknown', snap: null });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // Sync sticky scroll bar with the spreadsheet wrapper (same as Sequences.jsx)
  const syncingRef = useRef(false);
  const handleWrapperScroll = useCallback(() => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    if (stickyScrollRef.current && wrapperRef.current) {
      stickyScrollRef.current.scrollLeft = wrapperRef.current.scrollLeft;
    }
    syncingRef.current = false;
  }, []);
  const handleStickyScroll = useCallback(() => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    if (wrapperRef.current && stickyScrollRef.current) {
      wrapperRef.current.scrollLeft = stickyScrollRef.current.scrollLeft;
    }
    syncingRef.current = false;
  }, []);

  useEffect(() => {
    if (!wrapperRef.current || !scrollInnerRef.current) return;
    const updateWidth = () => {
      if (wrapperRef.current && scrollInnerRef.current) {
        scrollInnerRef.current.style.width = wrapperRef.current.scrollWidth + 'px';
      }
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(wrapperRef.current);
    return () => observer.disconnect();
  }, [state.snap?.sequences?.length]);

  if (state.loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: 'var(--text-secondary)' }}>
        <span className="spinner" style={{ marginRight: 10 }} /> Loading…
      </div>
    );
  }

  if (state.error === 'not_found') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', flexDirection: 'column', textAlign: 'center', padding: 40 }}>
        <h2 style={{ marginBottom: 8 }}>Link expired or revoked</h2>
        <p style={{ color: 'var(--text-secondary)' }}>This share link is no longer active. Please ask the sender for a new link.</p>
      </div>
    );
  }

  if (state.error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', flexDirection: 'column', textAlign: 'center', padding: 40 }}>
        <h2 style={{ marginBottom: 8 }}>Something went wrong</h2>
        <p style={{ color: 'var(--text-secondary)' }}>Please try again later.</p>
      </div>
    );
  }

  const { snap } = state;
  const maxMessages = Math.max(...(snap.sequences || []).map((s) => s.messages.length), 0);

  return (
    <div className="page" style={{ maxWidth: 'none', padding: 24 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0 }}>{snap.projectName || 'Sequences'}</h1>
          {snap.customerName && (
            <span style={{ color: 'var(--text-secondary)', fontSize: 16 }}>
              for {snap.customerName}
            </span>
          )}
          <span className="badge badge-delay" style={{ marginLeft: 'auto' }}>
            {snap.language === 'de' ? 'Deutsch' : 'English'} · Read-only
          </span>
        </div>
        {snap.lead && (snap.lead.firstName || snap.lead.company) && (
          <div style={{ marginTop: 10, color: 'var(--text-secondary)', fontSize: 14 }}>
            Addressed to {[snap.lead.firstName, snap.lead.lastName].filter(Boolean).join(' ')}
            {snap.lead.position ? `, ${snap.lead.position}` : ''}
            {snap.lead.company ? ` at ${snap.lead.company}` : ''}
          </div>
        )}
      </div>

      {(!snap.sequences || snap.sequences.length === 0) ? (
        <div className="empty-state">
          <h3>No sequences</h3>
          <p>This project does not have any sequences yet.</p>
        </div>
      ) : (
        <>
          <div className="seq-sticky-scroll" ref={stickyScrollRef} onScroll={handleStickyScroll}>
            <div ref={scrollInnerRef} style={{ height: 1 }} />
          </div>
          <div className="seq-spreadsheet-wrapper" ref={wrapperRef} onScroll={handleWrapperScroll}>
            <div
              className="seq-spreadsheet"
              style={{
                gridTemplateColumns: `100px repeat(${snap.sequences.length}, 450px)`,
                gridTemplateRows: `auto repeat(${maxMessages}, auto)`,
              }}
            >
              <div className="seq-corner-header"></div>
              {snap.sequences.map((seq) => (
                <div key={seq.id} className="seq-col-header">
                  <span className="seq-col-name">{seq.name}</span>
                </div>
              ))}

              {Array.from({ length: maxMessages }, (_, rowIdx) => (
                <React.Fragment key={`row-${rowIdx}`}>
                  <div className="seq-row-label">Message {rowIdx + 1}</div>
                  {snap.sequences.map((seq) => {
                    const msg = seq.messages[rowIdx];
                    if (!msg) return <div key={`${seq.id}-empty-${rowIdx}`} className="seq-cell seq-cell-empty">—</div>;
                    const output = snap.outputs?.[msg.id];
                    return (
                      <div
                        key={msg.id}
                        className={`seq-cell ${output ? 'seq-cell-filled' : ''}`}
                        style={{ cursor: 'default' }}
                      >
                        <div className="seq-cell-badges">
                          <span className={`badge ${msg.type === 'ai' ? 'badge-ai' : 'badge-static'}`}>
                            {msg.type}
                          </span>
                        </div>
                        <div className="seq-cell-text">
                          {output ? output : <em style={{ color: 'var(--text-secondary)' }}>Not generated yet</em>}
                        </div>
                      </div>
                    );
                  })}

                  {rowIdx < maxMessages - 1 && (
                    <>
                      <div className="seq-delay-label">Delay</div>
                      {snap.sequences.map((seq) => {
                        const nextMsg = seq.messages[rowIdx + 1];
                        if (!nextMsg) return <div key={`${seq.id}-delay-empty-${rowIdx}`} className="seq-delay-cell">—</div>;
                        return (
                          <div key={`${seq.id}-delay-${rowIdx}`} className="seq-delay-cell">
                            <span style={{ fontSize: 14 }}>{nextMsg.delayDays}</span>
                            <span className="seq-delay-unit">days</span>
                          </div>
                        );
                      })}
                    </>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
