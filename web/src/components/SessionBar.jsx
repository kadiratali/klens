import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const DEFAULT_CAPS = `{
  "platformName": "Android",
  "appium:automationName": "UiAutomator2",
  "appium:noReset": true,
  "appium:newCommandTimeout": 0
}`;

function HealthChip({ health }) {
  if (!health) return null;
  const label =
    health.status === 'reconnecting'
      ? `reconnecting ${health.reconnect?.attempt ?? 1}/${health.reconnect?.maxAttempts ?? '?'}`
      : health.status;
  return (
    <span className={`health-chip ${health.status}`} title={health.message || health.status}>
      <span className="health-dot" /> {label}
    </span>
  );
}

export default function SessionBar({
  sessionId,
  health,
  mode,
  onModeChange,
  live,
  onLiveChange,
  onPressKey,
  onSessionChange,
  onRefresh,
  loading,
  onError,
}) {
  const [appiumUrl, setAppiumUrl] = useState('http://127.0.0.1:4723');
  const [sessions, setSessions] = useState([]);
  const [pickedSession, setPickedSession] = useState('');
  const [showCaps, setShowCaps] = useState(false);
  const [caps, setCaps] = useState(DEFAULT_CAPS);

  useEffect(() => {
    api
      .getState()
      .then((s) => {
        setAppiumUrl(s.appiumUrl);
        if (s.sessionId) onSessionChange(s.sessionId);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadSessions() {
    onError(null);
    try {
      await api.setAppiumUrl(appiumUrl);
      const { sessions: list } = await api.listSessions();
      setSessions(list);
      setPickedSession(list.length ? list[0].id : '');
      if (!list.length) onError('No active sessions on the Appium server.');
    } catch (err) {
      onError(err.message);
    }
  }

  async function attach() {
    if (!pickedSession) return;
    onError(null);
    try {
      await api.attachSession(pickedSession);
      onSessionChange(pickedSession);
    } catch (err) {
      onError(err.message);
    }
  }

  async function createSession() {
    onError(null);
    let parsed;
    try {
      parsed = JSON.parse(caps);
    } catch {
      onError('Capabilities is not valid JSON.');
      return;
    }
    try {
      await api.setAppiumUrl(appiumUrl);
      const { sessionId: id } = await api.createSession(parsed);
      setShowCaps(false);
      onSessionChange(id);
    } catch (err) {
      onError(err.message);
    }
  }

  async function detach() {
    try {
      await api.detachSession();
    } catch {}
    onSessionChange(null);
  }

  function sessionLabel(s) {
    const c = s.capabilities;
    const device = c['appium:deviceName'] || c.deviceName || c['appium:udid'] || '';
    return `${s.id.slice(0, 8)}… ${c.platformName || ''} ${device}`.trim();
  }

  return (
    <header className="session-bar">
      <span className="logo">klens</span>
      <input
        className="url-input"
        value={appiumUrl}
        onChange={(e) => setAppiumUrl(e.target.value)}
        placeholder="Appium server URL"
        disabled={!!sessionId}
      />
      {!sessionId ? (
        <>
          <button onClick={loadSessions}>List sessions</button>
          <select
            value={pickedSession}
            onChange={(e) => setPickedSession(e.target.value)}
            disabled={!sessions.length}
          >
            {sessions.length === 0 && <option value="">— no sessions —</option>}
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {sessionLabel(s)}
              </option>
            ))}
          </select>
          <button onClick={attach} disabled={!pickedSession}>
            Attach
          </button>
          <button onClick={() => setShowCaps(true)}>New session…</button>
        </>
      ) : (
        <>
          <span className="session-chip" title={sessionId}>
            session {sessionId.slice(0, 8)}…
          </span>
          <HealthChip health={health} />
          <div className="mode-switch" title="Toggle with the 'i' key">
            <button
              className={mode === 'inspect' ? 'active' : ''}
              onClick={() => onModeChange('inspect')}
            >
              Inspect
            </button>
            <button
              className={mode === 'interact' ? 'active' : ''}
              onClick={() => onModeChange('interact')}
            >
              Interact
            </button>
          </div>
          <div className="hw-keys">
            <button onClick={() => onPressKey('back')} title="Back">
              ◁
            </button>
            <button onClick={() => onPressKey('home')} title="Home">
              ○
            </button>
            <button onClick={() => onPressKey('recents')} title="Recents">
              ▢
            </button>
          </div>
          <button
            className={`live-btn ${live ? 'on' : ''}`}
            onClick={() => onLiveChange(!live)}
            title="Auto-refresh while the screen changes (toggle with 'l')"
          >
            <span className="live-dot" /> Live
          </button>
          <button onClick={onRefresh} disabled={loading}>
            {loading ? 'Capturing…' : 'Refresh'}
          </button>
          <button onClick={detach}>Detach</button>
        </>
      )}
      {showCaps && (
        <div className="modal-backdrop" onClick={() => setShowCaps(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>New session capabilities</h3>
            <textarea value={caps} onChange={(e) => setCaps(e.target.value)} rows={10} />
            <div className="modal-actions">
              <button onClick={() => setShowCaps(false)}>Cancel</button>
              <button className="primary" onClick={createSession}>
                Start session
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
