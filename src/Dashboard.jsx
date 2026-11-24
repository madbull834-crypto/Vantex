import React, { useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import "./dashboard.css";
import Avatar from "./Avatar";
import ReferralQr from "./ReferralQr";
import {
  ArrowDownToLine, ArrowLeft, ArrowUpRight, BadgeDollarSign, BriefcaseBusiness, Check,
  ChevronDown, CircleAlert, CircleCheck, Coins, Copy, Crown, ExternalLink, Gift, LayoutDashboard, Link2,
  Lock, MessageCircle, Network, Plus, QrCode, RefreshCw, Repeat, Send, Share2, Sparkles, TrendingUp, Unlock,
  ChevronRight, Loader2, UserPlus, Users, Wallet, X
} from "lucide-react";

const DAY = 86_400;
const SALARY_CYCLE = 15 * DAY;
const EXPLORER = "https://testnet.bscscan.com/address/";
const planNames = ["Package 1", "Package 2", "Package 3", "Package 4"];
const planColors = ["gold", "blue", "purple", "green"];
// Balanced team volume needed to unlock ROI-on-ROI levels (mirrors qualifiedLevel in the contract).
const levelTiers = [{ upTo: 3, need: 100 }, { upTo: 7, need: 300 }, { upTo: 11, need: 800 }, { upTo: 15, need: 1500 }];
const salaryTiers = [{ need: 1000, pay: 25 }, { need: 2000, pay: 50 }, { need: 5000, pay: 125 }, { need: 10000, pay: 250 }, { need: 20000, pay: 500 }];

const money = (value, digits = 2) => Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const short = (address) => address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
const dateLabel = (seconds) => new Date(seconds * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// Cumulative Monday–Friday seconds since the Unix epoch (same rule as the contract).
const businessSecondsUntil = (timestamp) => {
  const elapsedDays = Math.floor(timestamp / DAY);
  const completeWeeks = Math.floor(elapsedDays / 7);
  const remainderDays = elapsedDays % 7;
  const weekdaysBeforeToday = remainderDays <= 2 ? remainderDays : remainderDays <= 4 ? 2 : remainderDays - 2;
  const todaySeconds = remainderDays < 2 || remainderDays > 3 ? timestamp % DAY : 0;
  return (completeWeeks * 5 + weekdaysBeforeToday) * DAY + todaySeconds;
};
const isEarningDay = (timestamp) => { const r = Math.floor(timestamp / DAY) % 7; return r !== 2 && r !== 3; };
const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };
const countdown = (seconds) => {
  if (seconds <= 0) return "now";
  const d = Math.floor(seconds / DAY); const h = Math.floor((seconds % DAY) / 3600); const m = Math.floor((seconds % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
};

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now() / 1000), intervalMs); return () => clearInterval(timer); }, [intervalMs]);
  return now;
}

function Progress({ value, tone = "gold" }) {
  return <div className={`db-progress ${tone}`}><i style={{ width: `${Math.min(100, Math.max(0, value))}%` }}/></div>;
}

export default function Dashboard(props) {
  const {
    account, connect, data, notice, busy, isConfigured, plans, selectedPlan,
    setSelectedPlan, amount, setAmount, projected, transact, tokenDecimals,
    registrationMode, setRegistrationMode,
    referralLink, copyReferralLink, linkReferrer, compoundPlan, openRegistration, levels = [],
    refresh, clearNotice, onSwitchAccount, onHome, loadTeam
  } = props;

  const [section, setSection] = useState("overview");
  const [walletMenu, setWalletMenu] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState("");
  const [showQr, setShowQr] = useState(false);
  // Team tree (direct members and members per level), loaded when the Team tab is opened.
  const [team, setTeam] = useState({ status: "idle", data: null, error: "" });
  const [openLevel, setOpenLevel] = useState(null);
  const fetchTeam = async () => {
    if (!account || !loadTeam) return;
    setTeam(current => ({ status: "loading", data: current.data, error: "" }));
    try { setTeam({ status: "ready", data: await loadTeam(account), error: "" }); }
    catch { setTeam(current => ({ status: "error", data: current.data, error: "Couldn't load your team right now. Check your connection and try again." })); }
  };
  useEffect(() => {
    if (section === "team" && data.member?.registered) fetchTeam();
  }, [section, account, data.member?.registered]);
  const loadedAt = useRef(Date.now() / 1000);
  const now = useNow();
  const member = data.member;
  const registered = Boolean(member?.registered);

  useEffect(() => { loadedAt.current = Date.now() / 1000; }, [data]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => clearNotice?.(), 7000);
    return () => clearTimeout(timer);
  }, [notice, clearNotice]);
  useEffect(() => { window.scrollTo({ top: 0, behavior: "smooth" }); }, [section]);

  const positions = useMemo(() => data.positions.map((position, index) => {
    const principal = Number(ethers.formatUnits(position.principal, tokenDecimals));
    const claimed = Number(ethers.formatUnits(position.claimed, tokenDecimals));
    const startedAt = Number(position.startedAt);
    const endsAt = Number(position.endsAt);
    const rate = Number(position.dailyRateBps) / 100;
    const profitRate = rate / 2;
    const profitPerDay = principal * profitRate / 100;
    const totalPayout = principal * 2;
    const targetDays = 200 / rate;
    const plan = Number(position.plan);
    return { index, principal, claimed, startedAt, endsAt, rate, profitRate, profitPerDay, totalPayout, targetDays, plan, name: planNames[plan] || "Package" };
  }), [data.positions, tokenDecimals]);

  // Live figures between refreshes: rewards accrue per second on Monday–Friday.
  const live = useMemo(() => {
    let earnedTotal = 0; let perSecond = 0; let activeCapital = 0; let perDay = 0; let profitPerDay = 0;
    const rows = positions.map(position => {
      const until = Math.min(now, position.endsAt);
      const earningSeconds = until > position.startedAt ? businessSecondsUntil(until) - businessSecondsUntil(position.startedAt) : 0;
      const earned = Math.min(position.totalPayout, position.principal * position.rate / 100 * earningSeconds / DAY);
      const active = now < position.endsAt;
      const daysDone = Math.min(position.targetDays, earningSeconds / DAY);
      if (active) { activeCapital += position.principal; perDay += position.principal * position.rate / 100; profitPerDay += position.profitPerDay; perSecond += position.principal * position.rate / 100 / DAY; }
      earnedTotal += earned;
      return { ...position, earned, active, daysDone, daysLeft: Math.max(0, Math.ceil(position.targetDays - daysDone)), progress: daysDone / position.targetDays * 100 };
    });
    const ticking = isEarningDay(now) && perSecond > 0;
    const pendingLive = Number(data.pending) + (ticking ? perSecond * Math.max(0, now - loadedAt.current) : 0);
    return { rows, earnedTotal, activeCapital, perDay, profitPerDay, capitalPerDay: perDay - profitPerDay, pendingLive, ticking };
  }, [positions, now, data.pending]);

  const totalClaimed = positions.reduce((sum, position) => sum + position.claimed, 0);
  const aBusiness = member ? Number(ethers.formatUnits(member.legABusiness, tokenDecimals)) : 0;
  const bBusiness = member ? Number(ethers.formatUnits(member.legBBusiness, tokenDecimals)) : 0;
  const totalBusiness = aBusiness + bBusiness;
  const aPercent = totalBusiness ? (aBusiness / totalBusiness) * 100 : 50;
  const balanced = Number(data.business || 0);
  const nextLevelTier = levelTiers.find(tier => tier.upTo > data.level);
  const salaryRank = member ? Number(member.salaryRank) : 0;
  const salaryClaims = member ? Number(member.salaryClaims) : 0;
  const salaryStartedAt = member ? Number(member.salaryStartedAt) : 0;
  const cyclesElapsed = salaryRank ? Math.min(6, Math.floor((now - salaryStartedAt) / SALARY_CYCLE)) : 0;
  const salaryClaimable = salaryRank ? Math.max(0, cyclesElapsed - salaryClaims) : 0;
  const nextSalaryAt = salaryRank && cyclesElapsed < 6 ? salaryStartedAt + (cyclesElapsed + 1) * SALARY_CYCLE : 0;
  const nextSalaryTier = salaryTiers[salaryRank];
  const salaryPay = salaryRank ? salaryTiers[salaryRank - 1].pay : 0;
  const hasDirect = data.directA !== ethers.ZeroAddress || data.directB !== ethers.ZeroAddress;
  const earningToday = isEarningDay(now);
  const plan = plans[selectedPlan];

  const steps = [
    { done: registered, label: "Join Vantex", hint: "One wallet confirmation", action: openRegistration, cta: "Join now" },
    { done: Number(data.balance) > 0 || positions.length > 0, label: "Get test mUSDT", hint: "Free tokens for the testnet", action: () => transact("mint"), cta: "Get 10,000" },
    { done: positions.length > 0, label: "Create your first position", hint: "Packages start at $1", action: () => setSection("portfolio"), cta: "Choose package" },
    { done: hasDirect, label: "Invite your first member", hint: "Share your referral link", action: () => setSection("team"), cta: "Get link" }
  ];
  const stepsDone = steps.filter(step => step.done).length;
  const nextStep = steps.find(step => !step.done);

  const doRefresh = async () => { setRefreshing(true); try { await refresh?.(); if (section === "team") await fetchTeam(); } finally { setTimeout(() => setRefreshing(false), 400); } };
  const copy = async (text, key) => { try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(""), 1800); } catch {} };
  const shareText = "Join my team on Vantex Capital:";
  const nativeShare = async () => { try { await navigator.share({ title: "Vantex Capital", text: shareText, url: referralLink }); } catch {} };
  const noticeTone = notice && /added|claimed|compounded|confirmed|success|copied|is on|will now/i.test(notice) ? "success" : "error";

  const navigation = [
    ["overview", LayoutDashboard, "Overview"],
    ["portfolio", BriefcaseBusiness, "Portfolio"],
    ["team", Network, "Team"],
    ["rewards", BadgeDollarSign, "Rewards"]
  ];
  const titles = { overview: `${greeting()}.`, portfolio: "Portfolio", team: "Your team", rewards: "Rewards" };

  // ---------- Reusable blocks ----------
  const ClaimCard = <section className="db-hero">
    <div className="db-hero-main">
      <span className="db-label"><Sparkles size={14}/> Available to claim</span>
      <strong className="db-hero-value">${money(live.pendingLive, live.ticking ? 4 : 2)}</strong>
      <p>{live.perDay > 0
        ? <>Profit <b>${money(live.profitPerDay)}</b> per earning day <span className="db-hero-sub">+ ${money(live.capitalPerDay)} capital returned</span> · {earningToday ? <span className="db-live"><i/>Accruing now</span> : <span className="db-paused">Weekend · resumes Monday</span>}</>
        : registered ? "Create a position to start earning Monday–Friday rewards." : "Join and create a position to start earning."}</p>
    </div>
    <div className="db-hero-actions">
      <button className="db-btn gold" disabled={busy || !account || Number(data.pending) <= 0} onClick={() => transact("claimRoi")}><ArrowDownToLine size={17}/> Claim to wallet</button>
      <button className="db-btn glass" disabled={busy || !account || !compoundPlan} onClick={() => transact("compoundRoi")} title={compoundPlan ? "" : "Needs at least $1 of rewards"}><Repeat size={16}/> {compoundPlan ? `Compound into ${compoundPlan.name}` : "Compound"}</button>
    </div>
    <div className="db-hero-glow"/>
  </section>;

  const InvestCard = <section className="db-card db-invest" id="new-position">
    <div className="db-card-head"><div><span className="db-eyebrow">Invest</span><h2>New position</h2></div><span className={`db-chip ${planColors[selectedPlan]}`}>{plan.name}</span></div>
    <label className="db-field-label">Amount <span>USDT</span></label>
    <div className="db-amount"><span>$</span><input type="number" min="1" max="2500" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} aria-label="Amount in USDT"/><button onClick={() => setAmount(String(Math.min(2500, Math.floor(Number(data.balance)))))} disabled={Number(data.balance) < 1}>Max</button></div>
    <div className="db-quick">{[100, 500, 1000, 2500].map(value => <button key={value} className={Number(amount) === value ? "active" : ""} onClick={() => setAmount(String(value))}>${value.toLocaleString()}</button>)}</div>
    <div className="db-plan-pick">{plans.map(item => <button key={item.index} className={`${planColors[item.index]} ${selectedPlan === item.index ? "active" : ""}`} onClick={() => setSelectedPlan(item.index)}><b>{item.rate}</b><span>profit/day · {item.label}</span></button>)}</div>
    <div className="db-summary">
      <div><span>Profit per day <small>{plan.rate} · Mon–Fri</small></span><b className="up">${money(Number(amount || 0) * plan.rateValue / 200)}</b></div>
      <div><span>Capital returned per day <small>{plan.rate}</small></span><b>${money(Number(amount || 0) * plan.rateValue / 200)}</b></div>
      <div><span>Term</span><b>{plan.days}</b></div>
      <div><span>Profit over the term</span><b className="up">+${money(Math.max(0, projected - Number(amount || 0)))}</b></div>
      <div className="total"><span>Total paid back <small>2× capital</small></span><b>${money(projected)}</b></div>
    </div>
    {account && member && !registered && <div className="db-mini-pick">
      <span>Your plan</span>
      <div><button className={registrationMode === 0 ? "active" : ""} onClick={() => setRegistrationMode(0)}>ROI</button><button className={registrationMode === 1 ? "active" : ""} onClick={() => setRegistrationMode(1)}>Compound</button></div>
    </div>}
    {account && Number(data.balance) < Number(amount || 0) && <p className="db-inline-warn"><CircleAlert size={14}/> Your wallet has ${money(data.balance)} mUSDT. <button onClick={() => transact("mint")} disabled={busy}>Get test tokens</button></p>}
    <button className="db-btn dark full" disabled={busy} onClick={() => transact("invest")}>{busy ? "Processing…" : !account ? "Connect wallet to continue" : registered ? "Create position" : "Join & create position"}<ArrowUpRight size={17}/></button>
    <p className="db-fine">Estimates follow the contract terms and are not guaranteed.</p>
  </section>;

  const renderPositions = (limit) => {
    const rows = limit ? live.rows.slice().reverse().slice(0, limit) : live.rows.slice().reverse();
    if (!rows.length) return <div className="db-empty"><BriefcaseBusiness size={30}/><b>No positions yet</b><span>Pick a package to create your first position.</span><button className="db-btn gold small" onClick={() => setSection("portfolio")}>Choose a package</button></div>;
    return <div className="db-positions">{rows.map(row => <article key={row.index} className="db-position">
      <div className="db-position-top">
        <span className={`db-dot ${planColors[row.plan]}`}/>
        <div><b>{row.name}</b><small>#{String(row.index + 1).padStart(2, "0")} · started {dateLabel(row.startedAt)}</small></div>
        <em className={row.active ? "on" : "off"}>{row.active ? "Active" : "Completed"}</em>
      </div>
      <div className="db-position-stats">
        <div><span>Capital</span><b>${money(row.principal)}</b></div>
        <div><span>Profit / day</span><b className="up">${money(row.profitPerDay)}</b><small>{row.profitRate.toFixed(2)}% of capital</small></div>
        <div><span>Profit earned</span><b className="up">${money(row.earned / 2)}</b><small>+ ${money(row.earned / 2)} capital back</small></div>
        <div><span>{row.active ? "Days left" : "Ended"}</span><b>{row.active ? row.daysLeft : dateLabel(row.endsAt)}</b></div>
      </div>
      <Progress value={row.progress} tone={planColors[row.plan]}/>
      <small className="db-position-foot">{Math.floor(row.daysDone)} of ≈{Math.ceil(row.targetDays)} earning days · ${money(row.claimed)} claimed of ${money(row.totalPayout)} (2× cap: ${money(row.principal)} profit + ${money(row.principal)} capital)</small>
    </article>)}</div>;
  };

  const ReferralCard = <section className="db-card db-referral">
    <div className="db-card-head"><div><span className="db-eyebrow">Invite</span><h2>Your referral link</h2></div><Gift size={20} className="db-gold"/></div>
    {referralLink ? <>
      <div className="db-link-row"><input readOnly value={referralLink} onFocus={event => event.target.select()} aria-label="Referral link"/><button className="db-btn gold small" onClick={() => { copyReferralLink(); setCopied("ref"); setTimeout(() => setCopied(""), 1800); }}>{copied === "ref" ? <><Check size={14}/> Copied</> : <><Copy size={14}/> Copy</>}</button></div>
      <div className="db-share">
        <a href={`https://wa.me/?text=${encodeURIComponent(`${shareText} ${referralLink}`)}`} target="_blank" rel="noreferrer"><MessageCircle size={15}/> WhatsApp</a>
        <a href={`https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer"><Send size={15}/> Telegram</a>
        <button onClick={() => setShowQr(true)}><QrCode size={15}/> QR code</button>
        {typeof navigator !== "undefined" && navigator.share && <button onClick={nativeShare}><Share2 size={15}/> More</button>}
      </div>
      {showQr && <ReferralQr link={referralLink} address={account} onClose={() => setShowQr(false)}/>}
      <div className="db-ref-address">
        <div><span>Your referral address</span><b title={account}>{account}</b><small>New members can paste this in the join window instead of using the link.</small></div>
        <button className="db-btn glass small" onClick={() => copy(account, "refaddr")}>{copied === "refaddr" ? <><Check size={14}/> Copied</> : <><Copy size={14}/> Copy address</>}</button>
      </div>
    </> : <div className="db-locked"><Lock size={16}/><span>{account ? "Join to get your personal referral link." : "Connect your wallet to get your referral link."}</span><button className="db-btn gold small" onClick={account ? openRegistration : () => connect()}>{account ? "Join now" : "Connect"}</button></div>}
    <div className="db-slots">
      {[["A", data.directA], ["B", data.directB]].map(([side, occupant]) => <div key={side} className={occupant === ethers.ZeroAddress ? "open" : ""}>
        {occupant === ethers.ZeroAddress ? <span className="db-slot-empty"><UserPlus size={16}/></span> : <Avatar address={occupant} size={32}/>}
        <div><span>Organization {side}</span><b>{occupant === ethers.ZeroAddress ? "Open spot" : short(occupant)}</b></div>
      </div>)}
    </div>
    <p className="db-fine">When both direct spots are filled, new members join the next open spot in your team.</p>
  </section>;

  const SalaryCard = <section className="db-card db-salary">
    <div className="db-card-head"><div><span className="db-eyebrow">Salary</span><h2>{salaryRank ? `Rank ${salaryRank}` : "Not ranked yet"}</h2></div><Crown size={22} className="db-gold"/></div>
    {salaryRank ? <>
      <div className="db-salary-row"><div><span>Pays</span><b>${salaryPay}</b><small>every 15 days</small></div><div><span>Cycles</span><b>{salaryClaims}/6</b><small>claimed</small></div><div><span>Next cycle</span><b>{nextSalaryAt ? countdown(nextSalaryAt - now) : "Done"}</b><small>{nextSalaryAt ? dateLabel(nextSalaryAt) : "all cycles unlocked"}</small></div></div>
      <Progress value={(salaryClaims / 6) * 100}/>
    </> : <p className="db-muted">Reach <b>${salaryTiers[0].need.toLocaleString()}</b> balanced team volume to unlock a ${salaryTiers[0].pay} salary every 15 days for 6 cycles.</p>}
    {nextSalaryTier && <div className="db-next">
      <div><span>Next: Rank {salaryRank + 1} · ${nextSalaryTier.pay}/cycle</span><b>${money(balanced, 0)} / ${nextSalaryTier.need.toLocaleString()}</b></div>
      <Progress value={(balanced / nextSalaryTier.need) * 100} tone="blue"/>
    </div>}
    <button className="db-btn gold full" disabled={busy || !account || salaryClaimable <= 0} onClick={() => transact("claimSalary")}>{salaryClaimable > 0 ? `Claim $${money(salaryClaimable * salaryPay, 0)} salary` : "No salary to claim yet"}</button>
  </section>;

  const TeamVolumeCard = <section className="db-card db-volume">
    <div className="db-card-head"><div><span className="db-eyebrow">Team volume</span><h2>Organization balance</h2></div>{section !== "team" && <button className="db-link-btn" onClick={() => setSection("team")}>Details <ArrowUpRight size={14}/></button>}</div>
    <div className="db-legs">
      <div className="a"><span>Organization A</span><b>${money(aBusiness, 0)}</b></div>
      <div className="b"><span>Organization B</span><b>${money(bBusiness, 0)}</b></div>
    </div>
    <div className="db-legbar"><i style={{ width: `${aPercent}%` }}/><em style={{ width: `${100 - aPercent}%` }}/></div>
    <div className="db-kv"><span>Balanced volume</span><b>${money(balanced, 0)}</b></div>
    <div className="db-kv"><span>ROI-on-ROI unlocked</span><b>Level {data.level} of 15</b></div>
    <p className="db-fine">Counts only for level (ROI-on-ROI) and salary income, never package returns.</p>
  </section>;

  // ---------- Views ----------
  const overview = <>
    {registered && stepsDone < steps.length && <section className="db-card db-onboard">
      <div className="db-onboard-head"><div><span className="db-eyebrow">Getting started</span><h2>{stepsDone} of {steps.length} done</h2></div><Progress value={(stepsDone / steps.length) * 100} tone="green"/></div>
      <div className="db-steps">{steps.map((step, index) => <div key={step.label} className={`${step.done ? "done" : ""} ${step === nextStep ? "next" : ""}`}>
        <span>{step.done ? <Check size={14}/> : index + 1}</span>
        <div><b>{step.label}</b><small>{step.hint}</small></div>
        {!step.done && step === nextStep && <button className="db-btn gold small" disabled={busy} onClick={step.action}>{step.cta}</button>}
      </div>)}</div>
    </section>}

    {ClaimCard}

    <section className="db-stats">
      <article><div className="db-stat-icon blue"><Wallet size={18}/></div><span>Wallet balance</span><strong>${money(data.balance)}</strong><button className="db-mini-btn" disabled={busy || !account} onClick={() => transact("mint")}><Plus size={13}/> Get test mUSDT</button></article>
      <article><div className="db-stat-icon gold"><BriefcaseBusiness size={18}/></div><span>Active capital</span><strong>${money(live.activeCapital)}</strong><small>{live.rows.filter(row => row.active).length} active · <b className="up">${money(live.profitPerDay)} profit/day</b></small></article>
      <article><div className="db-stat-icon green"><TrendingUp size={18}/></div><span>Total earned</span><strong>${money(live.earnedTotal)}</strong><small>${money(live.earnedTotal / 2)} profit + ${money(live.earnedTotal / 2)} capital · ${money(data.referralEarnings)} from team</small></article>
      <article><div className="db-stat-icon violet"><Users size={18}/></div><span>Balanced team volume</span><strong>${money(balanced, 0)}</strong><small>Level {data.level} of 15 unlocked</small></article>
    </section>

    <div className="db-grid">
      <section className="db-card">
        <div className="db-card-head"><div><span className="db-eyebrow">Portfolio</span><h2>Recent positions</h2></div>{live.rows.length > 0 && <button className="db-link-btn" onClick={() => setSection("portfolio")}>View all <ArrowUpRight size={14}/></button>}</div>
        {renderPositions(3)}
      </section>
      {InvestCard}
    </div>
    <div className="db-grid even">{TeamVolumeCard}{SalaryCard}</div>
  </>;

  const portfolio = <div className="db-grid">
    <section className="db-card">
      <div className="db-card-head"><div><span className="db-eyebrow">All positions</span><h2>{live.rows.length} position{live.rows.length === 1 ? "" : "s"}</h2></div>
        <div className="db-head-stats"><span>Capital <b>${money(positions.reduce((s, p) => s + p.principal, 0))}</b></span><span>Earned <b className="up">${money(live.earnedTotal)}</b></span></div></div>
      {renderPositions()}
    </section>
    {InvestCard}
  </div>;

  const teamLevels = team.data?.levels || [];
  const teamMembers = teamLevels.flat();
  const sideCount = (side) => teamMembers.filter(m => m.side === side).length;
  const teamDeposits = teamMembers.reduce((sum, m) => sum + m.deposit, 0);
  const deepestLevel = teamLevels.length;
  const teamLoading = team.status === "loading" && !team.data;

  const directs = team.data?.directs || [];
  const directsBySponsor = team.data?.directsSource === "sponsor";
  const [directFilter, directQuery] = [team.directFilter || "all", (team.directQuery || "").trim().toLowerCase()];
  const shownDirects = directs.filter(d => (directFilter === "all" || (directFilter === "active" ? d.deposit > 0 : d.deposit <= 0))
    && (!directQuery || d.address.toLowerCase().includes(directQuery)));
  const directDeposits = directs.reduce((sum, d) => sum + d.deposit, 0);
  const placementLabel = (d) => d.level == null ? "Placed deeper in your team"
    : d.level === 1 ? `Your Organization ${d.side === 0 ? "A" : "B"} spot`
    : `Org ${d.side === 0 ? "A" : "B"} · level ${d.level} · under ${short(d.parent)}`;

  const DirectTeamCard = <section className="db-card db-direct">
    <div className="db-card-head">
      <div><span className="db-eyebrow">Direct team</span><h2>{directsBySponsor ? "People who joined with your link" : "Your direct members"}</h2></div>
      <span className="db-chip">{teamLoading ? "…" : `${directs.length} ${directs.length === 1 ? "member" : "members"}`}</span>
    </div>
    <p className="db-muted">{directsBySponsor
      ? <>Everyone who joined using your referral link or wallet address. The first two take your Organization A and B spots; the rest are placed lower in your team.</>
      : <>Members in your two direct spots. After the contract upgrade, this shows everyone who joined with your link, wherever they were placed.</>}</p>

    {directs.length > 0 && <div className="db-direct-summary">
      <div><span>Joined with your link</span><b>{directs.length}</b></div>
      <div><span>Active (deposited)</span><b>{directs.filter(d => d.deposit > 0).length}</b></div>
      <div><span>Their deposits</span><b>${money(directDeposits, 0)}</b></div>
    </div>}

    {directs.length > 3 && <div className="db-direct-tools">
      <input value={team.directQuery || ""} onChange={event => setTeam(current => ({ ...current, directQuery: event.target.value }))} placeholder="Search by wallet address" aria-label="Search direct members"/>
      <div className="db-direct-filter" role="tablist">{[["all", "All"], ["active", "Active"], ["inactive", "No deposit"]].map(([key, label]) =>
        <button key={key} role="tab" aria-selected={directFilter === key} className={directFilter === key ? "active" : ""} onClick={() => setTeam(current => ({ ...current, directFilter: key }))}>{label}</button>)}</div>
    </div>}

    {teamLoading ? <div className="db-direct-list">{[0, 1, 2].map(i => <div key={i} className="db-direct-row skeleton"/>)}</div>
      : !directs.length ? <div className="db-direct-empty">
          <span className="db-slot-empty"><UserPlus size={18}/></span>
          <div><b>No one has joined with your link yet</b><small>Share your link or wallet address. New members appear here as soon as they join.</small></div>
          {referralLink && <button className="db-btn gold small" onClick={() => { copyReferralLink(); setCopied("ref"); setTimeout(() => setCopied(""), 1800); }}>{copied === "ref" ? <><Check size={14}/> Copied</> : <><Copy size={14}/> Copy link</>}</button>}
        </div>
      : <div className="db-direct-list">
          {shownDirects.map((d, index) => <div key={d.address} className="db-direct-row">
            <span className="db-direct-num">{directs.indexOf(d) + 1}</span>
            <Avatar address={d.address} size={36}/>
            <div className="db-direct-id"><b title={d.address}>{short(d.address)}</b><small>{placementLabel(d)}</small></div>
            <div className="db-direct-dep"><span>Deposited</span><b>${money(d.deposit)}</b></div>
            <em className={d.deposit > 0 ? "on" : "off"}>{d.deposit > 0 ? "Active" : "No deposit"}</em>
            <div className="db-direct-actions">
              <button onClick={() => copy(d.address, `d-${d.address}`)} aria-label="Copy address">{copied === `d-${d.address}` ? <Check size={13}/> : <Copy size={13}/>}</button>
              <a href={EXPLORER + d.address} target="_blank" rel="noreferrer" aria-label="View on BscScan"><ExternalLink size={13}/></a>
            </div>
          </div>)}
          {!shownDirects.length && <p className="db-fine">No members match this filter.</p>}
        </div>}
  </section>;

  const LevelTeamCard = <section className="db-card db-team-levels">
    <div className="db-card-head">
      <div><span className="db-eyebrow">Team by level</span><h2>{team.data ? `${team.data.total}${team.data.truncated ? "+" : ""} member${team.data.total === 1 ? "" : "s"} in your team` : "Your team"}</h2></div>
      <button className="db-link-btn" onClick={fetchTeam} disabled={team.status === "loading"}>{team.status === "loading" ? <><Loader2 size={14} className="db-spin"/> Loading</> : <><RefreshCw size={14}/> Refresh</>}</button>
    </div>
    {team.data && <div className="db-team-summary">
      <div><span>Organization A</span><b>{sideCount(0)}</b></div>
      <div><span>Organization B</span><b>{sideCount(1)}</b></div>
      <div><span>Deepest level</span><b>{deepestLevel ? `L${deepestLevel}` : "–"}</b></div>
      <div><span>Team deposits</span><b>${money(teamDeposits, 0)}</b></div>
    </div>}
    {team.status === "error" && <p className="db-inline-warn"><CircleAlert size={14}/> {team.error} <button onClick={fetchTeam}>Try again</button></p>}
    <div className="db-level-table" role="table" aria-label="Members per level">
      <div className="db-level-row head" role="row"><span>Level</span><span>Members</span><span>Org A</span><span>Org B</span><span>Deposits</span><span>Your ROI-on-ROI</span></div>
      {Array.from({ length: 15 }, (_, index) => {
        const rows = teamLevels[index] || [];
        const unlocked = index < data.level;
        const isOpen = openLevel === index && rows.length > 0;
        return <React.Fragment key={index}>
          <button role="row" className={`db-level-row ${rows.length ? "has" : "empty"} ${isOpen ? "open" : ""}`} onClick={() => rows.length && setOpenLevel(isOpen ? null : index)} disabled={!rows.length} aria-expanded={isOpen}>
            <span><ChevronRight size={14} className="db-level-chev"/>L{index + 1}</span>
            <span><b>{teamLoading ? "…" : rows.length}</b></span>
            <span>{rows.filter(m => m.side === 0).length}</span>
            <span>{rows.filter(m => m.side === 1).length}</span>
            <span>${money(rows.reduce((sum, m) => sum + m.deposit, 0), 0)}</span>
            <span className={unlocked ? "on" : "off"}>{unlocked ? <Unlock size={12}/> : <Lock size={12}/>} {levels[index]}%</span>
          </button>
          {isOpen && <div className="db-level-members">{rows.map(m => <div key={m.address} className="db-level-member">
            <Avatar address={m.address} size={28}/>
            <div><b title={m.address}>{short(m.address)}</b><small>Org {m.side === 0 ? "A" : "B"} · placed under {m.parent.toLowerCase() === account.toLowerCase() ? "you" : short(m.parent)}</small></div>
            <span className={m.deposit > 0 ? "dep" : "nodep"}>{m.deposit > 0 ? `$${money(m.deposit)}` : "No deposit"}</span>
            <button onClick={() => copy(m.address, m.address)} aria-label="Copy address">{copied === m.address ? <Check size={13}/> : <Copy size={13}/>}</button>
          </div>)}</div>}
        </React.Fragment>;
      })}
    </div>
    {team.data?.truncated && <p className="db-fine">Showing the first {team.data.total.toLocaleString()} members. Larger teams are cut off here to keep the page fast.</p>}
    <p className="db-fine">Deposits are each member's own package deposits. Levels follow placement: level 1 is your direct members, level 2 is their direct members, and so on. Lock icons show the ROI-on-ROI levels you haven't unlocked yet.</p>
  </section>;

  const teamView = <>
    <div className="db-grid even">{ReferralCard}{TeamVolumeCard}</div>
    {registered && DirectTeamCard}
    {registered && LevelTeamCard}
    <section className="db-card">
      <div className="db-card-head"><div><span className="db-eyebrow">ROI-on-ROI</span><h2>Level rewards</h2></div>
        <span className="db-chip green">{data.level} of 15 unlocked</span></div>
      <p className="db-muted">Earn a share of the ROI your team claims. Grow balanced volume in both organizations to unlock deeper levels.</p>
      {nextLevelTier && <div className="db-next">
        <div><span>Unlock levels {data.level + 1}–{nextLevelTier.upTo}</span><b>${money(balanced, 0)} / ${nextLevelTier.need.toLocaleString()} balanced volume</b></div>
        <Progress value={(balanced / nextLevelTier.need) * 100} tone="green"/>
      </div>}
      <div className="db-levels">{levels.map((rate, index) => {
        const unlocked = index < data.level;
        return <div key={index} className={unlocked ? "on" : ""}>{unlocked ? <Unlock size={13}/> : <Lock size={13}/>}<span>L{index + 1}</span><b>{rate}%</b></div>;
      })}</div>
    </section>
    {member?.registered && <section className="db-card db-sponsor">
      <Avatar address={member.referrer} size={44}/>
      <div><span className="db-eyebrow">Your sponsor</span><b>{member.referrer === ethers.ZeroAddress ? "Root account" : short(member.referrer)}</b></div>
      {member.referrer !== ethers.ZeroAddress && <a className="db-link-btn" href={EXPLORER + member.referrer} target="_blank" rel="noreferrer">View <ExternalLink size={13}/></a>}
    </section>}
  </>;

  const rewards = <>
    {ClaimCard}
    <div className="db-grid even">
      <section className="db-card">
        <div className="db-card-head"><div><span className="db-eyebrow">Reward mode</span><h2>How you receive ROI</h2></div><Coins size={20} className="db-gold"/></div>
        <div className="db-mode">
          <button className={data.rewardMode === 0 ? "active" : ""} disabled={busy || !registered || data.rewardMode === 0} onClick={() => transact("setRewardMode", 0)}><ArrowDownToLine size={18}/><b>Pay to my wallet</b><span>Claim whenever you like</span>{data.rewardMode === 0 && <CircleCheck size={16} className="db-mode-check"/>}</button>
          <button className={data.rewardMode === 1 ? "active" : ""} disabled={busy || !registered || data.rewardMode === 1} onClick={() => transact("setRewardMode", 1)}><Repeat size={18}/><b>Auto Compound</b><span>Reinvested Monday–Friday</span>{data.rewardMode === 1 && <CircleCheck size={16} className="db-mode-check"/>}</button>
        </div>
        <div className="db-kv"><span>Total claimed ROI</span><b>${money(totalClaimed)}</b></div>
        <div className="db-kv"><span>Team (ROI-on-ROI) earnings</span><b>${money(data.referralEarnings)}</b></div>
      </section>
      {SalaryCard}
    </div>
  </>;

  const views = { overview, portfolio, team: teamView, rewards };

  return <div className="db">
    <aside className="db-sidebar">
      <button className="db-brand" onClick={onHome}><span>V</span><div>VANTEX<small>CAPITAL</small></div></button>
      <nav>{navigation.map(([key, Icon, label]) => <button key={key} className={section === key ? "active" : ""} onClick={() => setSection(key)}><Icon size={18}/><span>{label}</span></button>)}</nav>
      <div className="db-side-foot">
        {account && <div className="db-side-account"><Avatar address={account} size={34}/><div><b>{short(account)}</b><span><i/>BSC Testnet</span></div></div>}
        <button className="db-back" onClick={onHome}><ArrowLeft size={15}/> Back to website</button>
      </div>
    </aside>

    <main className="db-main">
      <header className="db-topbar">
        <div>
          <span className="db-kicker">{new Date(now * 1000).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</span>
          <h1>{titles[section]}</h1>
        </div>
        <div className="db-top-actions">
          <button className={`db-icon-btn ${refreshing ? "spin" : ""}`} onClick={doRefresh} aria-label="Refresh data" disabled={!account}><RefreshCw size={17}/></button>
          {account ? <div className="db-wallet-wrap">
            <button className="db-wallet" onClick={() => setWalletMenu(value => !value)} aria-expanded={walletMenu}><Avatar address={account} size={26}/><span>{short(account)}</span><ChevronDown size={14}/></button>
            {walletMenu && <>
              <div className="db-menu-backdrop" onClick={() => setWalletMenu(false)}/>
              <div className="db-menu">
                <div className="db-menu-head"><Avatar address={account} size={36}/><div><b>{short(account)}</b><span>{registered ? "Member" : "Not joined yet"} · BSC Testnet</span></div></div>
                <button onClick={() => { copy(account, "addr"); }}>{copied === "addr" ? <Check size={15}/> : <Copy size={15}/>} {copied === "addr" ? "Copied" : "Copy address"}</button>
                <a href={EXPLORER + account} target="_blank" rel="noreferrer"><ExternalLink size={15}/> View on BscScan</a>
                <button onClick={() => { setWalletMenu(false); onSwitchAccount?.(); }}><Repeat size={15}/> Switch account</button>
              </div>
            </>}
          </div> : <button className="db-btn gold" onClick={() => connect()}><Wallet size={16}/> Connect wallet</button>}
        </div>
      </header>

      {!isConfigured && <div className="db-banner"><CircleAlert size={18}/><span><b>Preview mode.</b> Configure the contract addresses to enable live data and transactions.</span></div>}
      {!account && <div className="db-banner gold"><Gift size={18}/><span>{linkReferrer ? <><b>You've been invited</b> by {short(linkReferrer)}. Join to be placed in their team.</> : <><b>Welcome.</b> Connect your wallet to see your portfolio, or join in one minute.</>}</span><button className="db-btn gold small" onClick={openRegistration}>{linkReferrer ? "Accept invitation" : "Get started"}</button></div>}
      {account && member && !registered && <div className="db-banner gold"><UserPlus size={18}/><span><b>One step left.</b> Join with a single wallet confirmation to start investing and inviting.</span><button className="db-btn gold small" disabled={busy} onClick={openRegistration}>Join now</button></div>}

      <div className="db-view" key={section}>{views[section]}</div>
    </main>

    <nav className="db-tabbar">{navigation.map(([key, Icon, label]) => <button key={key} className={section === key ? "active" : ""} onClick={() => setSection(key)}><Icon size={20}/><span>{label}</span></button>)}</nav>

    {notice && <div className={`db-toast ${noticeTone}`} role="status">
      {noticeTone === "success" ? <CircleCheck size={18}/> : <CircleAlert size={18}/>}
      <span>{notice}</span>
      <button onClick={clearNotice} aria-label="Dismiss"><X size={16}/></button>
    </div>}
  </div>;
}
