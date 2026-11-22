import React, { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronDown, CircleAlert, CircleCheck, ClipboardPaste, Coins, Copy, Download, ExternalLink, Fuel, Gift, Link2, Loader2, MessageCircle, QrCode, RefreshCw, Smartphone, Sparkles, UserPlus, Users, Wallet, X } from "lucide-react";
import { ethers } from "ethers";
import { isMobile, mobileWalletLinks } from "./wallet";
import AvatarBase from "./Avatar";
import ReferralQr from "./ReferralQr";
const Avatar = (props) => <AvatarBase className="reg-avatar" {...props}/>;
import "./registration.css";

const short = (address) => address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
const FAUCET_URL = "https://www.bnbchain.org/en/testnet-faucet";
const EXPLORER_TX = "https://testnet.bscscan.com/tx/";
const EXPLORER_ADDRESS = "https://testnet.bscscan.com/address/";
const formatBnb = (wei) => {
  if (wei === null || wei === undefined) return "";
  const value = Number(ethers.formatEther(wei));
  return value === 0 ? "0" : value < 0.0001 ? "< 0.0001" : value.toLocaleString("en-US", { maximumFractionDigits: 4 });
};


// One continuous journey, so the visitor always knows what is happening and what is next.
const journey = [
  { key: "approve", label: "Connect wallet", hint: "Approve the connection in your wallet." },
  { key: "network", label: "Switch to BSC Testnet", hint: "Approve the network switch in your wallet." },
  { key: "placing", label: "Reserve your position", hint: "Finding your spot in your sponsor's team…" },
  { key: "wallet", label: "Confirm registration", hint: "Approve the registration in your wallet. It only costs a small gas fee." },
  { key: "mining", label: "Activate account", hint: "Recording your account on BSC Testnet. This usually takes a few seconds." }
];

export default function RegistrationWizard({
  open, onClose, account, connect, isConfigured, registered,
  stage, error, txHash, onRegister, onContinue,
  registrationMode, setRegistrationMode,
  sponsor, leg, linkReferrer, placementReady, placementError, onApplyInvite, joinFee, gasBalance, onSwitchAccount,
  onCheckReferrer, usdtBalance, onMintUsdt,
  referralLink, copyReferralLink, onInvest,
  wallets, connectStage, connectError, wrongNetwork, onSwitchNetwork
}) {
  const [showHelp, setShowHelp] = useState(false);
  const [copied, setCopied] = useState("");
  // Referrer entry: shown straight away for visitors who arrived without an invite link.
  const [editingRef, setEditingRef] = useState(!linkReferrer);
  const [refMode, setRefMode] = useState("address");
  const [refText, setRefText] = useState("");
  const [refCheck, setRefCheck] = useState({ status: "idle" });
  const primaryRef = useRef(null);
  const [showQr, setShowQr] = useState(false);
  const [walletId, setWalletId] = useState("");
  const [mint, setMint] = useState({ status: "idle", error: "" });
  const checkSeq = useRef(0);

  const linkChecked = useRef("");
  const [linkBroken, setLinkBroken] = useState(false);
  useEffect(() => {
    if (!open || !linkReferrer || linkChecked.current === linkReferrer) return;
    linkChecked.current = linkReferrer;
    onCheckReferrer(linkReferrer).then(result => {
      // Only a definite problem (not a member, own wallet) sends the visitor to fix the link, never a network hiccup.
      if (!result.error || result.retryable) { if (result.retryable) linkChecked.current = ""; return; }
      setLinkBroken(true); setEditingRef(true); setRefMode("address"); setRefText(linkReferrer);
    });
  }, [open, linkReferrer]);

  // Check the referrer as the visitor types or pastes, and apply it as soon as it's valid.
  useEffect(() => {
    const text = refText.trim();
    if (!text) { setRefCheck({ status: "idle" }); return; }
    const looksComplete = refMode === "link" ? /^https?:\/\//i.test(text) : text.length >= 42 || !/^0x[0-9a-f]*$/i.test(text);
    if (!looksComplete) { setRefCheck({ status: "typing" }); return; }
    const seq = ++checkSeq.current;
    setRefCheck({ status: "checking" });
    const timer = setTimeout(async () => {
      const result = await onCheckReferrer(text);
      if (seq !== checkSeq.current) return;
      if (result.error) { setRefCheck({ status: "invalid", error: result.error }); return; }
      setRefCheck({ status: "valid", address: result.address });
      const problem = await onApplyInvite(text);
      if (seq !== checkSeq.current) return;
      if (problem) setRefCheck({ status: "invalid", error: problem });
      else { setEditingRef(false); setLinkBroken(false); setRefText(""); setRefCheck({ status: "idle" }); }
    }, 450);
    return () => clearTimeout(timer);
  }, [refText, refMode]);

  const connecting = connectStage === "approve" || connectStage === "network";
  const loadingAccount = connectStage === "loading";
  const working = ["placing", "wallet", "mining"].includes(stage);
  const inFlow = connecting || loadingAccount || working;
  const waitingForGas = stage === "gas";
  const done = stage === "done" || (registered && stage !== "error");

  useEffect(() => {
    if (!open) return;
    const onKey = (event) => { if (event.key === "Escape" && !inFlow) onClose(); };
    window.addEventListener("keydown", onKey);
    primaryRef.current?.focus({ preventScroll: true });
    return () => window.removeEventListener("keydown", onKey);
  }, [open, inFlow, onClose]);

  if (!open) return null;

  const copy = async (text, label) => {
    try { await navigator.clipboard.writeText(text); setCopied(label); setTimeout(() => setCopied(""), 2000); } catch {}
  };
  const spillover = linkReferrer && sponsor && sponsor.toLowerCase() !== linkReferrer.toLowerCase();
  const flowKey = working ? stage : loadingAccount ? "placing" : connectStage;
  const activeIndex = Math.max(0, journey.findIndex(step => step.key === flowKey));
  const pasteFromClipboard = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) return;
      setRefMode(/^https?:\/\//i.test(text) ? "link" : "address");
      setRefText(text);
    } catch { setRefCheck({ status: "invalid", error: "Your browser blocked pasting. Long-press or right-click the box and choose Paste." }); }
  };
  const skipReferrer = async () => {
    setRefText(""); setRefCheck({ status: "idle" }); setEditingRef(false); setLinkBroken(false);
    if (linkReferrer) await onApplyInvite("");
  };
  // Don't let someone join by accident while a referrer they typed is still being checked or is invalid.
  const refPending = editingRef && refText.trim() !== "" && refCheck.status !== "idle";
  const invited = Boolean(linkReferrer) && !editingRef;
  const lowGas = account && gasBalance !== null && gasBalance !== undefined && joinFee !== null && gasBalance < joinFee;
  const hasUsdt = Number(usdtBalance || 0) > 0;
  const getTestUsdt = async () => {
    setMint({ status: "minting", error: "" });
    const problem = await onMintUsdt();
    setMint(problem ? { status: "idle", error: problem } : { status: "done", error: "" });
  };
  const selectedWallet = wallets.find(wallet => wallet.id === walletId) || wallets[0] || null;
  // The ROI / Compound buttons are the join action whenever a wallet can be used right here.
  const canJoin = Boolean(account) || (wallets.length > 0 && !wrongNetwork);
  const joinDisabled = !isConfigured || refPending || (Boolean(account) && (!placementReady || Boolean(placementError)));
  const join = (mode) => {
    setRegistrationMode(mode);
    if (account) onRegister(mode);
    else if (selectedWallet) onContinue(selectedWallet.provider, mode);
  };
  const joinLabel = (title) => stage === "error" ? "Try again" : !account && selectedWallet ? `Join with ${title}` : editingRef && !linkReferrer ? `Join with ${title}, no referrer` : `Join with ${title}`;

  const close = () => { if (!inFlow) onClose(); };

  return <div className="reg-overlay" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="reg-modal" role="dialog" aria-modal="true" aria-labelledby="reg-title">
      <button className="reg-close" onClick={close} disabled={inFlow} aria-label="Close"><X size={18}/></button>

      {done ? <div className="reg-success">
        <div className="reg-success-icon"><Check size={28}/></div>
        <span className="reg-kicker">WELCOME TO VANTEX</span>
        <h2 id="reg-title">You're in!</h2>
        <p>Your account is active{sponsor ? <> in <b>{short(sponsor)}</b>'s team</> : null}. A few quick things to do next:</p>
        <div className="reg-next">
          {hasUsdt
            ? <div className="reg-next-item done"><span><Check size={14}/></span><div><b>Test USDT ready</b><small>You have ${Number(usdtBalance).toLocaleString("en-US", { maximumFractionDigits: 2 })} test mUSDT to invest</small></div></div>
            : <button className="reg-next-item gold" disabled={mint.status === "minting"} onClick={getTestUsdt}>
                <span>1</span>
                <div><b>{mint.status === "minting" ? "Adding test USDT…" : "Get 10,000 free test USDT"}</b><small>{mint.status === "minting" ? "Confirm in your wallet, then wait a few seconds" : "Needed to create a position on the testnet"}</small></div>
                {mint.status === "minting" ? <Loader2 className="spin" size={16}/> : <Coins size={16}/>}
              </button>}
          {mint.error && <p className="reg-next-error"><CircleAlert size={13}/> {mint.error}</p>}
          <button ref={primaryRef} className={`reg-next-item ${hasUsdt ? "primary" : ""}`} onClick={onInvest}><span>2</span><div><b>Create your first position</b><small>Start earning Monday–Friday rewards</small></div><ArrowUpRight size={16}/></button>
        </div>
        {referralLink && <div className="reg-share">
          <div className="reg-share-head"><span>3</span><div><b>Share your invite</b><small>Your referral link is ready to use</small></div></div>
          <div className="reg-link"><input readOnly value={referralLink} onFocus={event => event.target.select()} aria-label="Your referral link"/><button onClick={() => copy(referralLink, "ref")}>{copied === "ref" ? <><Check size={14}/> Copied</> : <><Copy size={14}/> Copy</>}</button></div>
          <div className="reg-share-row">
            <a href={`https://wa.me/?text=${encodeURIComponent(`Join my team on Vantex Capital: ${referralLink}`)}`} target="_blank" rel="noreferrer"><MessageCircle size={15}/> WhatsApp</a>
            <button onClick={() => setShowQr(true)}><QrCode size={15}/> QR code</button>
          </div>
        </div>}
        {showQr && <ReferralQr link={referralLink} address={account} onClose={() => setShowQr(false)}/>}
        {txHash && <a className="reg-tx" href={EXPLORER_TX + txHash} target="_blank" rel="noreferrer">View transaction <ExternalLink size={12}/></a>}
        <button className="reg-text-btn center" onClick={onClose}>I'll do this later</button>
      </div>

      : inFlow ? <div className="reg-flow" aria-live="polite">
        <span className="reg-kicker"><Sparkles size={12}/> SETTING UP YOUR ACCOUNT</span>
        <h2 id="reg-title">{journey[activeIndex].label}</h2>
        <p className="reg-lead">{journey[activeIndex].hint}</p>
        <ol className="reg-journey">{journey.map((step, index) => <li key={step.key} className={index < activeIndex ? "complete" : index === activeIndex ? "active" : ""}>
          <i>{index < activeIndex ? <Check size={12}/> : index === activeIndex ? <Loader2 size={12}/> : index + 1}</i><span>{step.label}</span>
        </li>)}</ol>
        {(connecting || stage === "wallet") && <p className="reg-fine">Don't see a pop-up? Click your wallet's icon in the browser toolbar, or switch to the wallet app.</p>}
      </div>

      : waitingForGas ? <div className="reg-flow">
        <div className="reg-gas-icon"><Fuel size={24}/></div>
        <span className="reg-kicker">ONE LAST THING</span>
        <h2 id="reg-title">Add free test gas</h2>
        <p className="reg-lead">Your wallet needs a little tBNB to pay the network fee. It's free from the official faucet.</p>
        <ol className="reg-gas-steps">
          <li><span>1</span><div><b>Copy your wallet address</b><button className="reg-address" onClick={() => copy(account, "addr")}>{short(account)} {copied === "addr" ? <Check size={13}/> : <Copy size={13}/>}</button></div></li>
          <li><span>2</span><div><b>Paste it in the BNB faucet</b><a className="reg-primary small" href={FAUCET_URL} target="_blank" rel="noreferrer">Open faucet <ExternalLink size={14}/></a></div></li>
        </ol>
        <div className="reg-waiting"><Loader2 size={15}/><span>Waiting for gas… <b>We'll finish registration automatically</b> as soon as it arrives.</span></div>
        <button className="reg-text-btn center" onClick={() => onRegister()}><RefreshCw size={13}/> Check now</button>
      </div>

      : <>
        {invited ? <>
            <span className="reg-kicker"><Gift size={12}/> YOU'RE INVITED</span>
            <h2 id="reg-title">{short(linkReferrer)} invited you to Vantex</h2>
          </> : <>
            <span className="reg-kicker"><Sparkles size={12}/> ONE-MINUTE SETUP</span>
            <h2 id="reg-title">Join Vantex</h2>
          </>}
        <p className="reg-lead">No email or password. Your wallet is your account.</p>

        <div className="reg-sponsor">
          <span className="reg-section-label">Who referred you?</span>

          {editingRef ? <div className="reg-ref-editor">
              <div className="reg-segment" role="tablist" aria-label="Referrer type">
                <button role="tab" aria-selected={refMode === "address"} className={refMode === "address" ? "active" : ""} onClick={() => { setRefMode("address"); setRefText(""); }}><Wallet size={14}/> Wallet address</button>
                <button role="tab" aria-selected={refMode === "link"} className={refMode === "link" ? "active" : ""} onClick={() => { setRefMode("link"); setRefText(""); }}><Link2 size={14}/> Invite link</button>
              </div>
              <div className={`reg-ref-input ${refCheck.status}`}>
                <input value={refText} onChange={event => setRefText(event.target.value)} spellCheck={false} autoComplete="off" autoCapitalize="off"
                  placeholder={refMode === "address" ? "Referrer's wallet address (0x…)" : "Paste the invite link you received"}
                  aria-label={refMode === "address" ? "Referrer wallet address" : "Invite link"}/>
                {refText ? <button className="reg-ref-clear" onClick={() => setRefText("")} aria-label="Clear"><X size={15}/></button>
                  : <button className="reg-ref-paste" onClick={pasteFromClipboard}><ClipboardPaste size={14}/> Paste</button>}
              </div>
              <div className="reg-ref-status" aria-live="polite">
                {refCheck.status === "checking" ? <span className="checking"><Loader2 size={13}/> Checking referrer…</span>
                  : refCheck.status === "valid" ? <span className="ok"><CircleCheck size={14}/> Active member {short(refCheck.address)}. Applying…</span>
                  : refCheck.status === "invalid" ? <span className="bad"><CircleAlert size={14}/> {refCheck.error}</span>
                  : refCheck.status === "typing" ? <span>Keep typing. Wallet addresses have 42 characters.</span>
                  : <span>{refMode === "address" ? "Ask your referrer to copy their wallet address from their dashboard." : "The link your referrer shared with you."}</span>}
              </div>
              <div className="reg-ref-actions">
                <button className="reg-text-btn" onClick={skipReferrer}>I don't have a referrer</button>
                {linkReferrer && !linkBroken && <button className="reg-text-btn" onClick={() => { setEditingRef(false); setRefText(""); }}>Cancel</button>}
              </div>
            </div>

          : placementError ? <div className="reg-warn error"><CircleAlert size={14}/><span>{placementError}</span></div>

          : linkReferrer ? <div className="reg-sponsor-card stack">
              <div className="reg-sponsor-row">
                <Avatar address={linkReferrer}/>
                <div>
                  <b>Referred by <a href={EXPLORER_ADDRESS + linkReferrer} target="_blank" rel="noreferrer" title={linkReferrer}>{short(linkReferrer)}</a></b>
                  <span>You'll join their team automatically.</span>
                </div>
                <span className="reg-badge"><CircleCheck size={12}/> Verified</span>
              </div>
              <button className="reg-text-btn" onClick={() => { setEditingRef(true); setRefText(""); setRefCheck({ status: "idle" }); }}><RefreshCw size={12}/> Change referrer</button>
            </div>

          : <div className="reg-sponsor-card stack">
              <div className="reg-sponsor-row">
                <span className="reg-avatar empty"><Users size={18}/></span>
                <div><b>No referrer</b><span>We'll place you in the team automatically.</span></div>
              </div>
              <button className="reg-text-btn" onClick={() => { setEditingRef(true); }}><UserPlus size={13}/> Add a referrer</button>
            </div>}
        </div>

        {(error && stage === "error") || connectError ? <div className="reg-warn error"><CircleAlert size={14}/><span>{stage === "error" ? error : connectError}</span></div> : null}
        {!isConfigured && <div className="reg-warn"><CircleAlert size={14}/><span>Contracts aren't configured yet, so registration is disabled in preview mode.</span></div>}

        {canJoin ? <div className="reg-join">
            <span className="reg-section-label">{invited ? "Accept your invite with a plan" : "Join with a plan"}</span>

            {!account && wallets.length > 1 && <div className="reg-wallet-pick" role="radiogroup" aria-label="Your wallet">
              {wallets.map(wallet => <button key={wallet.id} role="radio" aria-checked={selectedWallet?.id === wallet.id} className={selectedWallet?.id === wallet.id ? "active" : ""} onClick={() => setWalletId(wallet.id)}>
                {wallet.icon ? <img src={wallet.icon} alt=""/> : <Wallet size={16}/>}<span>{wallet.name}</span>
              </button>)}
            </div>}
            {account ? <div className="reg-account">
                <Avatar address={account} size={22}/><span>{short(account)}</span><i/>BSC Testnet
                <button onClick={onSwitchAccount}>Switch</button>
              </div>
              : wallets.length === 1 && <div className="reg-account">{selectedWallet.icon ? <img src={selectedWallet.icon} alt=""/> : <Wallet size={14}/>}<span>Using {selectedWallet.name}</span></div>}

            <div className="reg-plan-join">
              {[{ mode: 0, Icon: Coins, title: "ROI", text: "Rewards paid to your wallet. Claim them Mon–Fri whenever you like." },
                { mode: 1, Icon: RefreshCw, title: "Compound", text: "Rewards reinvested automatically to grow your position." }].map(({ mode, Icon, title, text }) =>
                <button key={mode} disabled={joinDisabled} onClick={() => join(mode)}>
                  <span className="reg-plan-icon"><Icon size={20}/></span>
                  <b>{title}</b>
                  <span className="reg-plan-text">{text}</span>
                  <span className="reg-plan-go">{joinLabel(title)} <ArrowUpRight size={15}/></span>
                </button>)}
            </div>

            {account && !placementReady && isConfigured && <p className="reg-fee"><Loader2 className="spin" size={13}/> Preparing your registration…</p>}
            {refPending && <p className="reg-fee warn">{refCheck.status === "invalid" ? "Fix the referrer address above to continue." : "Checking referrer…"}</p>}
            {account && placementReady && !refPending && <p className={`reg-fee ${lowGas ? "warn" : ""}`}>
              <Fuel size={13}/>
              {joinFee !== null ? <>One confirmation · network fee ≈ {formatBnb(joinFee)} tBNB</> : <>One confirmation · small network fee</>}
              {gasBalance !== null && gasBalance !== undefined && <> · you have {formatBnb(gasBalance)} tBNB</>}
            </p>}
            {lowGas && <p className="reg-fee-help">Not enough tBNB for the fee yet. Tap a plan and we'll show you how to get free test BNB.</p>}
            <p className="reg-hint center">You can switch between ROI and Compound later from your dashboard.</p>
          </div>

        : <div className="reg-cta">
          {wrongNetwork ? <button ref={primaryRef} className="reg-primary" onClick={onSwitchNetwork}><RefreshCw size={16}/> Switch to BSC Testnet</button>
            : isMobile() ? <>
                <p className="reg-cta-note">Open this page in your wallet app. Your invitation comes with it.</p>
                <div className="reg-wallets">{mobileWalletLinks().map(link => <a key={link.name} href={link.url}><Smartphone size={18}/><b>Open in {link.name}</b><ArrowUpRight size={15}/></a>)}</div>
                <button className="reg-text-btn" onClick={() => copy(window.location.href, "page")}><Copy size={13}/> {copied === "page" ? "Link copied" : "Another wallet? Copy this link into its browser"}</button>
              </>
            : <>
                <p className="reg-cta-note">You need a free crypto wallet to join. It takes about a minute.</p>
                <div className="reg-wallets">
                  <a href="https://metamask.io/download/" target="_blank" rel="noreferrer"><Download size={18}/><b>Install MetaMask</b><ExternalLink size={14}/></a>
                  <a href="https://trustwallet.com/browser-extension" target="_blank" rel="noreferrer"><Download size={18}/><b>Install Trust Wallet</b><ExternalLink size={14}/></a>
                </div>
                <button className="reg-text-btn" onClick={() => window.location.reload()}><RefreshCw size={13}/> I've installed it, reload this page</button>
              </>}
        </div>}

        {!account && <>
          <button className="reg-text-btn" onClick={() => setShowHelp(value => !value)}><ChevronDown size={13} className={showHelp ? "flip" : ""}/> New to crypto wallets?</button>
          {showHelp && <div className="reg-help">
            <p>A wallet is your free login for Vantex. It holds your funds and approves actions, so there's no email or password.</p>
            <ol>
              <li>Install MetaMask or Trust Wallet and create a wallet. <b>Write down the recovery phrase and never share it.</b></li>
              <li>Come back and tap <em>Continue</em>. Approve the pop-ups in your wallet.</li>
              <li>If you have no test BNB for gas, we'll show you where to get it free.</li>
            </ol>
          </div>}
        </>}
        {!account && <p className="reg-fine">Joining is free apart from a small network gas fee.</p>}
      </>}
    </div>
  </div>;
}
