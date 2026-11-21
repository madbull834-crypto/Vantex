import React, { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Download, X } from "lucide-react";
import "./referral-qr.css";

// A scannable invite: someone points their phone camera (or wallet app scanner) at it to open the referral link.
export default function ReferralQr({ link, address, onClose }) {
  const [image, setImage] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(link, { width: 640, margin: 2, errorCorrectionLevel: "M", color: { dark: "#0b1420", light: "#ffffff" } })
      .then(url => { if (!cancelled) setImage(url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [link]);

  useEffect(() => {
    // Capture Escape first so it closes only this QR, not the window underneath.
    const onKey = (event) => { if (event.key === "Escape") { event.stopImmediatePropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {}
  };

  return <div className="rq-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="rq-card" role="dialog" aria-modal="true" aria-labelledby="rq-title">
      <button className="rq-close" onClick={onClose} aria-label="Close"><X size={18}/></button>
      <span className="rq-kicker">SCAN TO JOIN MY TEAM</span>
      <h2 id="rq-title">Your invite QR code</h2>
      <p>Ask them to scan this with their phone camera or wallet app. It opens your invite with you already set as their referrer.</p>
      <div className="rq-code">{image ? <img src={image} alt="QR code for your referral link"/> : <span className="rq-loading"/>}</div>
      {address && <small className="rq-address">Referrer {address.slice(0, 6)}…{address.slice(-4)}</small>}
      <div className="rq-actions">
        <a className={`rq-btn gold ${image ? "" : "disabled"}`} href={image || undefined} download="vantex-invite-qr.png"><Download size={16}/> Download</a>
        <button className="rq-btn" onClick={copy}>{copied ? <><Check size={16}/> Copied</> : <><Copy size={16}/> Copy link</>}</button>
      </div>
    </div>
  </div>;
}
