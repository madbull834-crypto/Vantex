import React from "react";

// A stable colour badge per address, so people recognise wallets without reading hex.
export default function Avatar({ address, size = 40, className = "" }) {
  const hex = (address || "0x0").toLowerCase().replace(/^0x/, "").padEnd(12, "0");
  const hueA = parseInt(hex.slice(0, 4), 16) % 360;
  const hueB = (hueA + 40 + (parseInt(hex.slice(4, 8), 16) % 120)) % 360;
  const angle = parseInt(hex.slice(8, 12), 16) % 360;
  return <span className={`avatar ${className}`} aria-hidden="true" style={{
    width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.3)),
    background: `linear-gradient(${angle}deg, hsl(${hueA} 70% 58%), hsl(${hueB} 65% 42%))`
  }}>{hex.slice(0, 2).toUpperCase()}</span>;
}
