import React, { useState } from 'react';

// Only BrowserStack is wired up for now; the rest render as disabled "soon"
// cards, mirroring Appium Inspector's provider grid.
const PROVIDERS = [
  { id: 'saucelabs', name: 'Sauce Labs' },
  { id: 'headspin', name: 'HeadSpin' },
  { id: 'browserstack', name: 'BrowserStack', enabled: true },
  { id: 'lambdatest', name: 'LambdaTest' },
  { id: 'testingbot', name: 'TestingBot' },
  { id: 'experitest', name: 'Experitest' },
  { id: 'bitbar', name: 'BitBar' },
  { id: 'kobiton', name: 'Kobiton' },
  { id: 'perfecto', name: 'Perfecto' },
  { id: 'pcloudy', name: 'pCloudy' },
];

export default function CloudProviderModal({ initialUsername = '', onConnect, onDisconnect, connected, onClose }) {
  const [selected, setSelected] = useState('browserstack');
  const [username, setUsername] = useState(initialUsername);
  const [accessKey, setAccessKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function connect() {
    if (!username || !accessKey) {
      setError('Username and access key are required.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onConnect({ provider: 'browserstack', username, accessKey });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal cloud-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Select Cloud Provider</h3>
        <div className="provider-grid">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              className={`provider-card${selected === p.id ? ' selected' : ''}${p.enabled ? '' : ' disabled'}`}
              disabled={!p.enabled}
              onClick={() => p.enabled && setSelected(p.id)}
            >
              {p.name}
              {!p.enabled && <span className="soon">soon</span>}
            </button>
          ))}
        </div>

        {selected === 'browserstack' && (
          <div className="provider-form">
            <label>
              BrowserStack username
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
            </label>
            <label>
              Access key
              <input
                type="password"
                value={accessKey}
                onChange={(e) => setAccessKey(e.target.value)}
                autoComplete="off"
                placeholder={connected ? '•••••••• (saved)' : ''}
              />
            </label>
            <p className="hint">
              Find these under BrowserStack → Account → Settings. Stored locally on this device.
            </p>
            {error && <p className="form-error">{error}</p>}
            <div className="modal-actions">
              {connected && (
                <button onClick={onDisconnect} disabled={busy}>
                  Disconnect
                </button>
              )}
              <button onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button className="primary" onClick={connect} disabled={busy}>
                {busy ? 'Connecting…' : 'Connect'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
