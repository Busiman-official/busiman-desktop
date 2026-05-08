import React from 'react';

export const PurchasePlaceholderPanel: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => {
  return (
    <div style={{ padding: 20, background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0' }}>
      <h3 style={{ margin: 0, fontSize: 18, color: '#0f172a' }}>{title}</h3>
      <p style={{ marginTop: 8, marginBottom: 0, color: '#64748b' }}>{subtitle}</p>
    </div>
  );
};
