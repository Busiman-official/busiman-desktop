/**
 * Edge Device Registry - unified admin view for proxy/gate/combined devices
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { devicesService, RegisterEdgeDevicePayload, UpdateEdgeDevicePayload } from '@/services/devices.service';
import { EdgeDevice } from '@/types';
import './PersonalSettings.css';
import './EdgeDeviceRegistrySection.css';

const HEARTBEAT_TIMEOUT_MS = 3 * 60 * 1000;

function isOnline(d: EdgeDevice): boolean {
  if (!d.isActive || !d.lastSeen) return false;
  const ts = new Date(d.lastSeen).getTime();
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < HEARTBEAT_TIMEOUT_MS;
}

function capLabel(d: EdgeDevice): string {
  const caps: string[] = [];
  if (d.capabilities?.proxy) caps.push('Proxy');
  if (d.capabilities?.gateBeacon) caps.push('Beacon');
  if (d.capabilities?.gateAudio) caps.push('Voice');
  return caps.length ? caps.join(' · ') : 'None';
}

export const EdgeDeviceRegistrySection: React.FC = () => {
  const [devices, setDevices] = useState<EdgeDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filter, setFilter] = useState<'all' | 'proxy' | 'gate' | 'combined'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [showRegister, setShowRegister] = useState(false);
  const [registerForm, setRegisterForm] = useState<RegisterEdgeDevicePayload>({
    deviceId: '',
    secret: '',
    displayName: '',
    deviceType: 'unknown',
    capabilities: { proxy: false, gateBeacon: false, gateAudio: false },
  });
  const [registerResult, setRegisterResult] = useState<{ deviceId: string; secret: string } | null>(null);

  const [saving, setSaving] = useState(false);
  const [rotatedSecret, setRotatedSecret] = useState<{ deviceId: string; secret: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);
      const data = await devicesService.getAll();
      setDevices(data);
      if (selectedId && !data.some((d) => d.deviceId === selectedId)) setSelectedId(null);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Failed to load devices');
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    return devices.filter((d) => {
      const isProxy = !!d.capabilities?.proxy;
      const isGate = !!d.capabilities?.gateAudio || !!d.capabilities?.gateBeacon;
      const isCombined = isProxy && isGate;
      if (filter === 'proxy') return isProxy && !isGate;
      if (filter === 'gate') return isGate && !isProxy;
      if (filter === 'combined') return isCombined;
      return true;
    });
  }, [devices, filter]);

  const selected = useMemo(() => devices.find((d) => d.deviceId === selectedId) || null, [devices, selectedId]);

  const [edit, setEdit] = useState<UpdateEdgeDevicePayload | null>(null);
  useEffect(() => {
    if (!selected) {
      setEdit(null);
      return;
    }
    setEdit({
      displayName: selected.displayName || '',
      deviceType: (selected.deviceType as any) || 'unknown',
      isActive: selected.isActive,
      capabilities: { ...selected.capabilities },
    });
  }, [selected]);

  const handleSave = async () => {
    if (!selected || !edit) return;
    try {
      setSaving(true);
      setError(null);
      await devicesService.update(selected.deviceId, edit);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Failed to update device');
    } finally {
      setSaving(false);
    }
  };

  const handleRotateSecret = async () => {
    if (!selected) return;
    if (!window.confirm(`Rotate secret for "${selected.displayName || selected.deviceId}"? This will require reflashing/reconfiguring the device.`)) {
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const res = await devicesService.rotateSecret(selected.deviceId);
      setRotatedSecret(res);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Failed to rotate secret');
    } finally {
      setSaving(false);
    }
  };

  const handleRegister = async () => {
    if (!registerForm.deviceId.trim() || !registerForm.secret.trim()) {
      setError('deviceId and secret are required');
      return;
    }
    try {
      setSaving(true);
      setError(null);
      await devicesService.register({
        ...registerForm,
        deviceId: registerForm.deviceId.trim(),
        secret: registerForm.secret.trim(),
        displayName: registerForm.displayName?.trim() || undefined,
      });
      setRegisterResult({ deviceId: registerForm.deviceId.trim(), secret: registerForm.secret.trim() });
      setShowRegister(false);
      setRegisterForm({
        deviceId: '',
        secret: '',
        displayName: '',
        deviceType: 'unknown',
        capabilities: { proxy: false, gateBeacon: false, gateAudio: false },
      });
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Failed to register device');
    } finally {
      setSaving(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  };

  if (loading) {
    return <div className="settings-section-loading">Loading devices...</div>;
  }

  return (
    <div className="edge-device-registry">
      <div className="edge-device-registry-toolbar">
        <div className="edge-device-registry-filters">
          <button type="button" className={`btn-chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
            All
          </button>
          <button type="button" className={`btn-chip ${filter === 'proxy' ? 'active' : ''}`} onClick={() => setFilter('proxy')}>
            Proxy
          </button>
          <button type="button" className={`btn-chip ${filter === 'gate' ? 'active' : ''}`} onClick={() => setFilter('gate')}>
            Gate
          </button>
          <button type="button" className={`btn-chip ${filter === 'combined' ? 'active' : ''}`} onClick={() => setFilter('combined')}>
            Combined
          </button>
        </div>

        <div className="edge-device-registry-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={() => load()} disabled={saving}>
            Refresh
          </button>
          <button type="button" className="btn-primary btn-sm" onClick={() => setShowRegister(true)} disabled={saving}>
            + Register device
          </button>
        </div>
      </div>

      {error && <div className="settings-error">{error}</div>}

      {registerResult && (
        <div className="settings-success edge-device-secret-card">
          <div className="edge-device-secret-title">Device registered</div>
          <div className="edge-device-secret-row">
            <span className="edge-device-secret-label">deviceId</span>
            <code>{registerResult.deviceId}</code>
            <button type="button" className="btn-secondary btn-xs" onClick={() => copy(registerResult.deviceId)}>
              Copy
            </button>
          </div>
          <div className="edge-device-secret-row">
            <span className="edge-device-secret-label">secret</span>
            <code>{registerResult.secret}</code>
            <button type="button" className="btn-secondary btn-xs" onClick={() => copy(registerResult.secret)}>
              Copy
            </button>
          </div>
          <div className="edge-device-secret-hint">Save this secret. You’ll need it in firmware config.</div>
          <button type="button" className="btn-link" onClick={() => setRegisterResult(null)}>
            Dismiss
          </button>
        </div>
      )}

      {rotatedSecret && (
        <div className="settings-success edge-device-secret-card">
          <div className="edge-device-secret-title">Secret rotated</div>
          <div className="edge-device-secret-row">
            <span className="edge-device-secret-label">deviceId</span>
            <code>{rotatedSecret.deviceId}</code>
            <button type="button" className="btn-secondary btn-xs" onClick={() => copy(rotatedSecret.deviceId)}>
              Copy
            </button>
          </div>
          <div className="edge-device-secret-row">
            <span className="edge-device-secret-label">secret</span>
            <code>{rotatedSecret.secret}</code>
            <button type="button" className="btn-secondary btn-xs" onClick={() => copy(rotatedSecret.secret)}>
              Copy
            </button>
          </div>
          <div className="edge-device-secret-hint">Reflash/reconfigure the device with the new secret.</div>
          <button type="button" className="btn-link" onClick={() => setRotatedSecret(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="edge-device-registry-layout">
        <div className="settings-card edge-device-list">
          <div className="settings-card-header">
            <h3>Devices</h3>
          </div>
          <div className="settings-card-content edge-device-list-content">
            {filtered.length === 0 ? (
              <div className="settings-info-text">No devices found.</div>
            ) : (
              filtered.map((d) => {
                const online = isOnline(d);
                return (
                  <button
                    key={d.deviceId}
                    type="button"
                    className={`edge-device-row ${selectedId === d.deviceId ? 'selected' : ''}`}
                    onClick={() => setSelectedId(d.deviceId)}
                  >
                    <span className={`edge-device-dot ${online ? 'online' : 'offline'}`} />
                    <span className="edge-device-main">
                      <span className="edge-device-name">{d.displayName || d.deviceId}</span>
                      <span className="edge-device-sub">{d.deviceId}</span>
                    </span>
                    <span className="edge-device-meta">{capLabel(d)}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="settings-card edge-device-details">
          <div className="settings-card-header">
            <h3>Details</h3>
          </div>
          <div className="settings-card-content">
            {!selected || !edit ? (
              <div className="settings-info-text">Select a device to view and edit details.</div>
            ) : (
              <div className="edge-device-form">
                <div className="form-grid">
                  <div className="form-group">
                    <label>Device ID</label>
                    <input className="form-input disabled" value={selected.deviceId} disabled />
                  </div>
                  <div className="form-group">
                    <label>Display name</label>
                    <input
                      className="form-input"
                      value={edit.displayName || ''}
                      onChange={(e) => setEdit({ ...edit, displayName: e.target.value })}
                      disabled={saving}
                    />
                  </div>
                  <div className="form-group">
                    <label>Device type</label>
                    <select
                      className="form-input"
                      value={(edit.deviceType as any) || 'unknown'}
                      onChange={(e) => setEdit({ ...edit, deviceType: e.target.value as any })}
                      disabled={saving}
                    >
                      <option value="unknown">unknown</option>
                      <option value="esp8266">esp8266</option>
                      <option value="esp32">esp32</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Status</label>
                    <select
                      className="form-input"
                      value={edit.isActive ? 'active' : 'inactive'}
                      onChange={(e) => setEdit({ ...edit, isActive: e.target.value === 'active' })}
                      disabled={saving}
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                </div>

                <div className="edge-device-capabilities">
                  <div className="edge-device-capabilities-title">Capabilities</div>
                  <label className="edge-device-capability">
                    <input
                      type="checkbox"
                      checked={!!edit.capabilities?.proxy}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          capabilities: { ...edit.capabilities, proxy: e.target.checked },
                        })
                      }
                      disabled={saving}
                    />
                    Proxy
                  </label>
                  <label className="edge-device-capability">
                    <input
                      type="checkbox"
                      checked={!!edit.capabilities?.gateBeacon}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          capabilities: { ...edit.capabilities, gateBeacon: e.target.checked },
                        })
                      }
                      disabled={saving}
                    />
                    Gate beacon
                  </label>
                  <label className="edge-device-capability">
                    <input
                      type="checkbox"
                      checked={!!edit.capabilities?.gateAudio}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          capabilities: { ...edit.capabilities, gateAudio: e.target.checked },
                        })
                      }
                      disabled={saving}
                    />
                    Voice (DFPlayer)
                  </label>
                </div>

                <div className="edge-device-actions-row">
                  <button type="button" className="btn-secondary" onClick={handleRotateSecret} disabled={saving}>
                    Rotate secret
                  </button>
                  <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
                    Save
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showRegister && (
        <div className="edge-device-modal-backdrop" role="dialog" aria-modal="true">
          <div className="edge-device-modal">
            <div className="edge-device-modal-header">
              <div className="edge-device-modal-title">Register device</div>
              <button type="button" className="btn-link" onClick={() => setShowRegister(false)}>
                Close
              </button>
            </div>
            <div className="edge-device-modal-body">
              <div className="form-grid">
                <div className="form-group">
                  <label>Device ID *</label>
                  <input
                    className="form-input"
                    value={registerForm.deviceId}
                    onChange={(e) => setRegisterForm({ ...registerForm, deviceId: e.target.value })}
                    placeholder="gate-proxy-001"
                  />
                </div>
                <div className="form-group">
                  <label>Secret *</label>
                  <input
                    className="form-input"
                    value={registerForm.secret}
                    onChange={(e) => setRegisterForm({ ...registerForm, secret: e.target.value })}
                    placeholder="shared secret"
                  />
                </div>
                <div className="form-group">
                  <label>Display name</label>
                  <input
                    className="form-input"
                    value={registerForm.displayName || ''}
                    onChange={(e) => setRegisterForm({ ...registerForm, displayName: e.target.value })}
                    placeholder="Main gate device"
                  />
                </div>
                <div className="form-group">
                  <label>Device type</label>
                  <select
                    className="form-input"
                    value={registerForm.deviceType || 'unknown'}
                    onChange={(e) => setRegisterForm({ ...registerForm, deviceType: e.target.value as any })}
                  >
                    <option value="unknown">unknown</option>
                    <option value="esp8266">esp8266</option>
                    <option value="esp32">esp32</option>
                  </select>
                </div>
              </div>

              <div className="edge-device-capabilities">
                <div className="edge-device-capabilities-title">Capabilities</div>
                <label className="edge-device-capability">
                  <input
                    type="checkbox"
                    checked={!!registerForm.capabilities?.proxy}
                    onChange={(e) =>
                      setRegisterForm({
                        ...registerForm,
                        capabilities: { ...registerForm.capabilities, proxy: e.target.checked },
                      })
                    }
                  />
                  Proxy
                </label>
                <label className="edge-device-capability">
                  <input
                    type="checkbox"
                    checked={!!registerForm.capabilities?.gateBeacon}
                    onChange={(e) =>
                      setRegisterForm({
                        ...registerForm,
                        capabilities: { ...registerForm.capabilities, gateBeacon: e.target.checked },
                      })
                    }
                  />
                  Gate beacon
                </label>
                <label className="edge-device-capability">
                  <input
                    type="checkbox"
                    checked={!!registerForm.capabilities?.gateAudio}
                    onChange={(e) =>
                      setRegisterForm({
                        ...registerForm,
                        capabilities: { ...registerForm.capabilities, gateAudio: e.target.checked },
                      })
                    }
                  />
                  Voice (DFPlayer)
                </label>
              </div>
            </div>

            <div className="edge-device-modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setShowRegister(false)} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={handleRegister} disabled={saving}>
                Register
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

