/**
 * Proxy Servers Section - List and manage NodeMCU proxy servers (Admin only)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { nodemcuProxyService } from '@/services/nodemcu-proxy.service';
import { NodeMCUProxy } from '@/types';
import './ProxyServersSection.css';

const HEARTBEAT_TIMEOUT_MS = 3 * 60 * 1000;

function isNodeMCUOnline(proxy: NodeMCUProxy): boolean {
  if (!proxy.lastHeartbeat || !proxy.isActive) return false;
  try {
    const ts = new Date(proxy.lastHeartbeat).getTime();
    return Date.now() - ts < HEARTBEAT_TIMEOUT_MS;
  } catch {
    return false;
  }
}

export const ProxyServersSection: React.FC = () => {
  const [proxies, setProxies] = useState<NodeMCUProxy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);

  const loadProxies = useCallback(async () => {
    try {
      setError(null);
      const data = await nodemcuProxyService.getAll();
      setProxies(data);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to load proxy servers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProxies();
  }, [loadProxies]);

  const handleDeactivate = (proxy: NodeMCUProxy) => {
    if (
      !window.confirm(
        `Are you sure you want to deactivate "${proxy.displayName || proxy.nodeMCUId}"? It will no longer be available for attendance discovery.`
      )
    ) {
      return;
    }
    (async () => {
      try {
        setDeactivatingId(proxy.nodeMCUId);
        await nodemcuProxyService.deactivate(proxy.nodeMCUId);
        await loadProxies();
      } catch (err: any) {
        setError(err?.response?.data?.message || err?.message || 'Failed to deactivate proxy');
      } finally {
        setDeactivatingId(null);
      }
    })();
  };

  const handleAddSuccess = () => {
    setShowAddForm(false);
    loadProxies();
  };

  if (loading) {
    return (
      <div className="proxy-servers-section">
        <div className="settings-section-loading">Loading proxy servers...</div>
      </div>
    );
  }

  return (
    <div className="proxy-servers-section">
      <div className="proxy-servers-header">
        <h3 className="proxy-servers-title">Proxy Servers</h3>
        <button type="button" className="btn-primary btn-sm" onClick={() => setShowAddForm(true)}>
          + Add Proxy Server
        </button>
      </div>

      {error && (
        <div className="settings-error">
          {error}
          <button type="button" className="error-dismiss" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}

      {proxies.length === 0 ? (
        <div className="proxy-servers-empty">
          <p className="proxy-servers-empty-text">No proxy servers</p>
          <p className="proxy-servers-empty-subtext">
            Add a NodeMCU device to enable offline attendance proxy.
          </p>
          <button type="button" className="btn-primary btn-sm" onClick={() => setShowAddForm(true)}>
            Add Proxy Server
          </button>
        </div>
      ) : (
        <div className="proxy-servers-list">
          {proxies.map((proxy) => {
            const online = isNodeMCUOnline(proxy);
            const isDeactivating = deactivatingId === proxy.nodeMCUId;

            return (
              <div key={proxy.id} className="proxy-servers-card">
                <div className="proxy-servers-card-header">
                  <div className="proxy-servers-card-info">
                    <div className="proxy-servers-card-name">
                      {proxy.displayName || proxy.nodeMCUId}
                    </div>
                    {proxy.displayName && (
                      <span className="proxy-servers-card-id">{proxy.nodeMCUId}</span>
                    )}
                    <span
                      className={`proxy-servers-status-badge ${
                        online ? 'proxy-servers-status-online' : 'proxy-servers-status-offline'
                      }`}
                    >
                      {online ? 'Online' : 'Offline'}
                    </span>
                  </div>
                  {proxy.isActive && (
                    <button
                      type="button"
                      className={`btn-danger btn-sm proxy-servers-deactivate ${
                        isDeactivating ? 'proxy-servers-deactivate-disabled' : ''
                      }`}
                      onClick={() => handleDeactivate(proxy)}
                      disabled={isDeactivating}
                    >
                      {isDeactivating ? 'Deactivating...' : 'Deactivate'}
                    </button>
                  )}
                  {!proxy.isActive && (
                    <span className="proxy-servers-inactive-badge">Inactive</span>
                  )}
                </div>
                {proxy.ipAddress && (
                  <div className="proxy-servers-detail-row">
                    {proxy.ipAddress}:{proxy.port}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showAddForm && (
        <NodeMCUProxyFormModal
          onClose={() => setShowAddForm(false)}
          onSuccess={handleAddSuccess}
        />
      )}
    </div>
  );
};

interface NodeMCUProxyFormModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

function NodeMCUProxyFormModal({ onClose, onSuccess }: NodeMCUProxyFormModalProps) {
  const [nodeMCUId, setNodeMCUId] = useState('');
  const [secret, setSecret] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const validate = (): boolean => {
    if (!nodeMCUId?.trim()) {
      setFormError('NodeMCU ID is required');
      return false;
    }
    if (!secret?.trim()) {
      setFormError('Secret is required');
      return false;
    }
    setFormError(null);
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || loading) return;

    try {
      setLoading(true);
      setFormError(null);
      await nodemcuProxyService.register(nodeMCUId.trim(), secret.trim(), displayName.trim() || undefined);
      setNodeMCUId('');
      setSecret('');
      setDisplayName('');
      onSuccess();
    } catch (err: any) {
      setFormError(err?.response?.data?.message || err?.message || 'Failed to register NodeMCU');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="proxy-servers-modal-overlay" onClick={onClose}>
      <div className="proxy-servers-modal-content" onClick={(e) => e.stopPropagation()}>
        <h3 className="proxy-servers-modal-title">Add Proxy Server</h3>
        <p className="proxy-servers-modal-subtitle">
          Register a NodeMCU device to act as an attendance proxy server.
        </p>

        {formError && (
          <div className="settings-error">
            {formError}
            <button type="button" className="error-dismiss" onClick={() => setFormError(null)}>
              ×
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="proxy-servers-form">
          <div className="form-group">
            <label>NodeMCU ID *</label>
            <input
              type="text"
              className="form-input"
              value={nodeMCUId}
              onChange={(e) => setNodeMCUId(e.target.value)}
              placeholder="e.g. ESP_ABC123"
              disabled={loading}
            />
          </div>
          <div className="form-group">
            <label>Secret *</label>
            <input
              type="password"
              className="form-input"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Secret key configured on the NodeMCU"
              disabled={loading}
            />
          </div>
          <div className="form-group">
            <label>Display Name (optional)</label>
            <input
              type="text"
              className="form-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Reception Desk"
              disabled={loading}
            />
          </div>
          <div className="proxy-servers-form-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Registering...' : 'Register NodeMCU'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
