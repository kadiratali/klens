import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import CloudProviderModal from './CloudProviderModal.jsx';

const DEFAULT_CAPS = `{
  "platformName": "Android",
  "appium:automationName": "UiAutomator2",
  "appium:noReset": true,
  "appium:newCommandTimeout": 0
}`;

// Pre-filled when connected to BrowserStack. Credentials go via the Basic-auth
// header (not caps), so the user only edits device/app here.
const BROWSERSTACK_CAPS = `{
  "platformName": "Android",
  "appium:automationName": "UiAutomator2",
  "appium:deviceName": "Google Pixel 7",
  "appium:platformVersion": "13.0",
  "appium:app": "bs://<your-uploaded-app-id>",
  "bstack:options": {
    "projectName": "klens",
    "sessionName": "inspect",
    "debug": true
  }
}`;

const BS_STORE_KEY = 'klens.browserstack';

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
  const [showCloud, setShowCloud] = useState(false);
  const [provider, setProvider] = useState(null);
  const [bsUsername, setBsUsername] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    async function init() {
      let s;
      try {
        s = await api.getState();
      } catch {
        return;
      }
      // Restore a saved BrowserStack connection: the desktop server starts fresh
      // each launch, so re-apply the locally stored credentials to the backend.
      let saved = null;
      try {
        saved = JSON.parse(localStorage.getItem(BS_STORE_KEY) || 'null');
      } catch {}
      if (saved?.username && saved?.accessKey && !s.sessionId) {
        try {
          const r = await api.setProvider({ provider: 'browserstack', ...saved });
          setProvider('browserstack');
          setBsUsername(saved.username);
          setAppiumUrl(r.appiumUrl);
          setCaps(BROWSERSTACK_CAPS);
          return;
        } catch {
          // fall through to plain state on failure
        }
      }
      setAppiumUrl(s.appiumUrl);
      setProvider(s.provider || null);
      if (s.sessionId) onSessionChange(s.sessionId);
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadSessions() {
    onError(null);
    try {
      // A cloud provider already set the URL + auth; setAppiumUrl would clear them.
      if (!provider) await api.setAppiumUrl(appiumUrl);
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
    setCreating(true);
    try {
      // A cloud provider already set the URL + auth; setAppiumUrl would clear them.
      if (!provider) await api.setAppiumUrl(appiumUrl);
      const { sessionId: id } = await api.createSession(parsed);
      setShowCaps(false);
      onSessionChange(id);
    } catch (err) {
      onError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function detach() {
    try {
      await api.detachSession();
    } catch {}
    onSessionChange(null);
  }

  async function connectProvider({ username, accessKey }) {
    const r = await api.setProvider({ provider: 'browserstack', username, accessKey });
    localStorage.setItem(BS_STORE_KEY, JSON.stringify({ username, accessKey }));
    setProvider('browserstack');
    setBsUsername(username);
    setAppiumUrl(r.appiumUrl);
    setCaps(BROWSERSTACK_CAPS);
    setShowCloud(false);
  }

  async function disconnectProvider() {
    try {
      const r = await api.setProvider({ provider: null });
      setAppiumUrl(r.appiumUrl);
    } catch {}
    localStorage.removeItem(BS_STORE_KEY);
    setProvider(null);
    setBsUsername('');
    setCaps(DEFAULT_CAPS);
    setShowCloud(false);
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
        disabled={!!sessionId || !!provider}
      />
      {!sessionId && (
        <button
          className={`cloud-btn${provider ? ' on' : ''}`}
          onClick={() => setShowCloud(true)}
          title="Connect through a cloud provider"
        >
          {provider === 'browserstack' ? '☁ BrowserStack' : '☁ Cloud'}
        </button>
      )}
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
        <div className="modal-backdrop" onClick={() => !creating && setShowCaps(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>New session capabilities</h3>
            <textarea
              value={caps}
              onChange={(e) => setCaps(e.target.value)}
              rows={10}
              disabled={creating}
            />
            {creating && (
              <div className="session-starting">
                <span className="spinner" />
                <span>
                  Starting session…{' '}
                  {provider === 'browserstack'
                    ? 'the cloud device is being allocated and the app installed — this can take up to a minute.'
                    : 'launching on the device…'}
                </span>
              </div>
            )}
            <div className="modal-actions">
              <button onClick={() => setShowCaps(false)} disabled={creating}>
                Cancel
              </button>
              <button className="primary" onClick={createSession} disabled={creating}>
                {creating ? 'Starting…' : 'Start session'}
              </button>
            </div>
          </div>
        </div>
      )}
      {showCloud && (
        <CloudProviderModal
          initialUsername={bsUsername}
          connected={provider === 'browserstack'}
          onConnect={connectProvider}
          onDisconnect={disconnectProvider}
          onClose={() => setShowCloud(false)}
        />
      )}
    </header>
  );
}
