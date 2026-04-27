import React from "react";

type IndicatorRippleProps = {
  className?: string;
  title?: string;
};

export function IndicatorRipple({
  className = "",
  title = "Attention required",
}: IndicatorRippleProps) {
  return (
    <span
      style={{
        position: "relative",
        width: 12,
        height: 12,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      className={className}
      title={title}
      aria-hidden="true"
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          backgroundColor: "#2563eb",
          zIndex: 2,
        }}
      />
      <span style={{ ...waveBase, animationDelay: "0s" }} />
      <span style={{ ...waveBase, animationDelay: "0.45s" }} />
      <span style={{ ...waveBase, animationDelay: "0.9s" }} />
      <style>
        {`
          @keyframes indicator-ripple-inline {
            0% { transform: scale(1); opacity: 0.7; }
            80% { transform: scale(2.6); opacity: 0; }
            100% { transform: scale(2.6); opacity: 0; }
          }
        `}
      </style>
    </span>
  );
}

export default IndicatorRipple;

const waveBase: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  borderRadius: "50%",
  border: "1.5px solid #60a5fa",
  animation: "indicator-ripple-inline 1.8s ease-out infinite",
  pointerEvents: "none",
};