import React, { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronDown, CircleAlert, Coins, Copy, Download, ExternalLink, Fuel, Gift, Link2, Loader2, RefreshCw, Smartphone, Sparkles, Users, Wallet, X } from "lucide-react";
import { ethers } from "ethers";
import { isMobile, mobileWalletLinks } from "./wallet";
import AvatarBase from "./Avatar";
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
  referralLink, copyReferralLink, onInvest,
  wallets, connectStage, connectError, wrongNetwork, onSwitchNetwork
}) {
  const [showHelp, setShowHelp] = useState(false);
  const [copied, setCopied] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteText, setInviteText] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const primaryRef = useRef(null);

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
  const submitInvite = async (event) => {
    event.preventDefault();
    setInviteBusy(true); setInviteError("");
    const problem = await onApplyInvite(inviteText);
    setInviteBusy(false);
    if (problem) setInviteError(problem);
    else { setInviteOpen(false); setInviteText(""); }
  };
  const lowGas = account && gasBalance !== null && gasBalance !== undefined && joinFee !== null && gasBalance < joinFee;
  const singleWallet = wallets.length === 1 ? wallets[0] : null;

  const close = () => { if (!inFlow) onClose(); };

  return <div className="reg-overlay" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="reg-modal" role="dialog" aria-modal="true" aria-labelledby="reg-title">
      <button className="reg-close" onClick={close} disabled={inFlow} aria-label="Close"><X size={18}/></button>

      {done ? <div className="reg-success">
        <div className="reg-success-icon"><Check size={28}/></div>
        <span className="reg-kicker">WELCOME TO VANTEX</span>
        <h2 id="reg-title">You're in!</h2>
        <p>Your account is active{sponsor ? <> in <b>{short(sponsor)}</b>'s team</> : null}. Two quick things to do next:</p>
        <div className="reg-next">
          <button ref={primaryRef} className="reg-next-item primary" onClick={onInvest}><span>1</span><div><b>Create your first position</b><small>Start earning Monday–Friday rewards</small></div><ArrowUpRight size={16}/></button>
          {referralLink && <button className="reg-next-item" onClick={() => { copyReferralLink(); setCopied("ref"); setTimeout(() => setCopied(""), 2000); }}><span>2</span><div><b>{copied === "ref" ? "Referral link copied!" : "Copy your referral link"}</b><small>Invite people to your Organization A &amp; B</small></div>{copied === "ref" ? <Check size={16}/> : <Copy size={16}/>}</button>}
        </div>
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
        <button className="reg-text-btn center" onClick={onRegister}><RefreshCw size={13}/> Check now</button>
      </div>

      : <>
        <span className="reg-kicker"><Sparkles size={12}/> ONE-MINUTE SETUP</span>
        <h2 id="reg-title">Join Vantex</h2>
        <p className="reg-lead">No email or password. Your wallet is your account.</p>

        <div className="reg-sponsor">
          <span className="reg-section-label">Your sponsor</span>
          {placementError ? <div className="reg-warn error"><CircleAlert size={14}/><span>{placementError}</span></div>
            : account && !placementReady && isConfigured ? <div className="reg-sponsor-card"><span className="reg-avatar skeleton"/><div><b className="reg-skeleton-line"/><span>Finding your spot in the team…</span></div></div>
            : (sponsor || linkReferrer) ? <div className="reg-sponsor-card">
                <Avatar address={sponsor || linkReferrer}/>
                <div>
                  <b>{linkReferrer ? "Invited by " : "Placed under "}<a href={EXPLORER_ADDRESS + (sponsor || linkReferrer)} target="_blank" rel="noreferrer" title={sponsor || linkReferrer}>{short(sponsor || linkReferrer)}</a></b>
                  <span>{!account ? "Your spot is reserved automatically when you join."
                    : spillover ? <>Their direct spots are full, so you'll join their team under {short(sponsor)} in Organization {leg === 1 ? "B" : "A"}.</>
                    : linkReferrer ? <>You'll take their open Organization {leg === 1 ? "B" : "A"} spot.</>
                    : <>You don't have an invite link, so we picked the next open Organization {leg === 1 ? "B" : "A"} spot for you.</>}</span>
                </div>
                {linkReferrer && <span className="reg-badge"><Gift size={12}/> Invited</span>}
              </div>
            : <div className="reg-sponsor-card"><span className="reg-avatar empty"><Users size={18}/></span><div><b>Assigned automatically</b><span>We'll place you in the next open spot when you join.</span></div></div>}

          {!inviteOpen ? <button className="reg-text-btn" onClick={() => { setInviteOpen(true); setInviteError(""); }}>
              <Link2 size={13}/> {linkReferrer ? "Use a different invite link" : "Have an invite link? Add it here"}
            </button>
            : <form className="reg-invite-form" onSubmit={submitInvite}>
                <input autoFocus value={inviteText} onChange={event => setInviteText(event.target.value)} placeholder="Paste invite link or sponsor's wallet address" aria-label="Invite link or sponsor address"/>
                <button type="submit" disabled={inviteBusy || !inviteText.trim()}>{inviteBusy ? <Loader2 className="spin" size={14}/> : "Apply"}</button>
                <button type="button" className="reg-invite-cancel" onClick={() => { setInviteOpen(false); setInviteError(""); }} aria-label="Cancel"><X size={15}/></button>
                {inviteError && <small>{inviteError}</small>}
              </form>}
        </div>

        <div className="reg-settings">
          <span className="reg-section-label">Choose your plan</span>
          <div className="reg-choices reg-plan-choices">
            <button className={registrationMode === 0 ? "active" : ""} aria-pressed={registrationMode === 0} onClick={() => setRegistrationMode(0)}>
              <Coins size={18}/><b>ROI</b><span>Rewards are paid to your wallet. Claim them Mon–Fri whenever you like.</span>
              {registrationMode === 0 && <Check size={15} className="reg-plan-check"/>}
            </button>
            <button className={registrationMode === 1 ? "active" : ""} aria-pressed={registrationMode === 1} onClick={() => setRegistrationMode(1)}>
              <RefreshCw size={18}/><b>Compound</b><span>Rewards are reinvested automatically to grow your position.</span>
              {registrationMode === 1 && <Check size={15} className="reg-plan-check"/>}
            </button>
          </div>
          <p className="reg-hint">You can switch between ROI and Compound later from your dashboard.</p>
        </div>

        {(error && stage === "error") || connectError ? <div className="reg-warn error"><CircleAlert size={14}/><span>{stage === "error" ? error : connectError}</span></div> : null}
        {!isConfigured && <div className="reg-warn"><CircleAlert size={14}/><span>Contracts aren't configured yet, so registration is disabled in preview mode.</span></div>}

        <div className="reg-cta">
          {account ? <>
              <div className="reg-account">
                <Avatar address={account} size={22}/><span>{short(account)}</span><i/>BSC Testnet
                <button onClick={onSwitchAccount}>Switch</button>
              </div>
              <ul className="reg-benefits">
                <li><Check size={14}/>Your own referral link</li>
                <li><Check size={14}/>Earn from your team</li>
                <li><Check size={14}/>Packages from $1</li>
              </ul>
              <button ref={primaryRef} className="reg-primary" disabled={!isConfigured || !placementReady || Boolean(placementError)} onClick={onRegister}>
                {!placementReady && isConfigured ? <><Loader2 className="spin" size={16}/> Preparing…</> : stage === "error" ? "Try again" : <>Join now <ArrowUpRight size={16}/></>}
              </button>
              <p className={`reg-fee ${lowGas ? "warn" : ""}`}>
                <Fuel size={13}/>
                {joinFee !== null ? <>One confirmation · network fee ≈ {formatBnb(joinFee)} tBNB</> : <>One confirmation · small network fee</>}
                {gasBalance !== null && gasBalance !== undefined && <> · you have {formatBnb(gasBalance)} tBNB</>}
              </p>
              {lowGas && <p className="reg-fee-help">Not enough tBNB for the fee. Click <b>Join now</b> and we'll show you how to get free test BNB.</p>}
            </>
            : wrongNetwork ? <button ref={primaryRef} className="reg-primary" onClick={onSwitchNetwork}><RefreshCw size={16}/> Switch to BSC Testnet</button>
            : singleWallet ? <button ref={primaryRef} className="reg-primary" disabled={!isConfigured} onClick={() => onContinue(singleWallet.provider)}>
                {singleWallet.icon ? <img src={singleWallet.icon} alt=""/> : <Wallet size={16}/>} Continue with {singleWallet.name}
              </button>
            : wallets.length ? <div className="reg-wallets">{wallets.map(wallet => <button key={wallet.id} disabled={!isConfigured} onClick={() => onContinue(wallet.provider)}>
                {wallet.icon ? <img src={wallet.icon} alt=""/> : <Wallet size={18}/>}<b>Continue with {wallet.name}</b><ArrowUpRight size={15}/>
              </button>)}</div>
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
        </div>

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
