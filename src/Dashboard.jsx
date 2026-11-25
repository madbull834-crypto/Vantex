import React, { useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import "./dashboard.css";
import Avatar from "./Avatar";
import ReferralQr from "./ReferralQr";
import {
  ArrowDownToLine, ArrowLeft, ArrowUpRight, BadgeDollarSign, BriefcaseBusiness, Check,
  ChevronDown, CircleAlert, CircleCheck, Coins, Copy, Crown, ExternalLink, Gift, LayoutDashboard, Link2,
  Lock, MessageCircle, Network, Plus, QrCode, RefreshCw, Repeat, Send, Share2, Sparkles, TrendingUp, Unlock,
  ChevronRight, Layers, Loader2, UserPlus, Users, Wallet, X
} from "lucide-react";

const DAY = 86_400;
const MIN_CLAIM = 5; // USDT, mirrors MIN_CLAIM_USD in the contract
const SALARY_CYCLE = 15 * DAY;
const EXPLORER = "https://testnet.bscscan.com/address/";
const planNames = ["Package 1", "Package 2", "Package 3", "Package 4", "Starter", "Growth", "Elite"];
const planColors = ["gold", "blue", "purple", "green", "blue", "green", "purple"];
const isCompoundPlan = (plan) => plan >= 4;
// Balanced team volume needed to unlock ROI-on-ROI levels (mirrors qualifiedLevel in the contract).
const levelTiers = [{ upTo: 3, need: 100 }, { upTo: 7, need: 400 }, { upTo: 11, need: 1200 }, { upTo: 15, need: 2700 }];
const salaryTiers = [{ need: 1000, pay: 25 }, { need: 2000, pay: 50 }, { need: 5000, pay: 125 }, { need: 10000, pay: 250 }, { need: 20000, pay: 500 }];

const money = (value, digits = 2) => Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const short = (address) => address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
const timeLabel = (seconds) => new Date(seconds * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const dayKey = (seconds) => { const d = new Date(seconds * 1000); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
const dayHeading = (seconds) => {
  const key = dayKey(seconds); const today = Date.now() / 1000;
  if (key === dayKey(today)) return "Today";
  if (key === dayKey(today - DAY)) return "Yesterday";
  return new Date(seconds * 1000).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" });
};
const ago = (seconds, now) => {
  const diff = Math.max(0, now - seconds);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)} d ago`;
  return dateLabel(seconds);
};
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
    account, connect, data, notice, busy, isConfigured, plans, compoundPlans = [], selectedPlan,
    setSelectedPlan, amount, setAmount, projected, transact, tokenDecimals,
    registrationMode, setRegistrationMode,
    referralLink, copyReferralLink, linkReferrer, openRegistration, levels = [],
    refresh, clearNotice, onSwitchAccount, onHome, loadTeam, loadRoiIncome
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
  // ROI-on-ROI income (totals per level and payment history), loaded when its tab is opened.
  const [income, setIncome] = useState({ status: "idle", data: null, error: "" });
  const [incomeLevel, setIncomeLevel] = useState(0);
  const [incomeShown, setIncomeShown] = useState(30);
  const fetchIncome = async () => {
    if (!account || !loadRoiIncome) return;
    setIncome(current => ({ status: "loading", data: current.data, error: "" }));
    try { setIncome({ status: "ready", data: await loadRoiIncome(account), error: "" }); }
    catch { setIncome(current => ({ status: "error", data: current.data, error: "Couldn't load your ROI-on-ROI income right now. Check your connection and try again." })); }
  };
  useEffect(() => {
    if (section === "income" && data.member?.registered) fetchIncome();
  }, [section, account, data.member?.registered, data.referralEarnings]);
  useEffect(() => { setIncome({ status: "idle", data: null, error: "" }); setIncomeLevel(0); setIncomeShown(30); }, [account]);
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
    const contractDetails = data.roiDetails?.[index];
    const principal = Number(ethers.formatUnits(position.principal, tokenDecimals));
    const claimed = Number(ethers.formatUnits(position.claimed, tokenDecimals));
    const startedAt = Number(position.startedAt);
    const endsAt = Number(position.endsAt);
    const rate = Number(position.dailyRateBps) / 100;
    const plan = Number(position.plan);
    const compound = isCompoundPlan(plan);
    // Packages: half profit, half capital each day until 2x. Compounding plans: all profit, principal back at the end.
    const profitRate = compound ? rate : rate / 2;
    const profitPerDay = principal * profitRate / 100;
    const targetDays = compound ? Math.round((businessSecondsUntil(endsAt) - businessSecondsUntil(startedAt)) / DAY) : 200 / rate;
    const totalProfit = compound ? principal * rate / 100 * targetDays : principal;
    const totalPayout = principal + totalProfit;
    const onchain = contractDetails ? {
      accruedPayout: Number(ethers.formatUnits(contractDetails.accruedPayout, tokenDecimals)),
      claimablePayout: Number(ethers.formatUnits(contractDetails.claimablePayout, tokenDecimals)),
      profitAccrued: Number(ethers.formatUnits(contractDetails.profitAccrued, tokenDecimals)),
      capitalReturned: Number(ethers.formatUnits(contractDetails.capitalReturned, tokenDecimals)),
      maximumPayout: Number(ethers.formatUnits(contractDetails.maximumPayout, tokenDecimals)),
      active: contractDetails.active
    } : null;
    return { index, principal, claimed, startedAt, endsAt, rate, profitRate, profitPerDay, totalPayout, totalProfit, targetDays, plan, compound, onchain, name: planNames[plan] || "Package" };
  }), [data.positions, data.roiDetails, tokenDecimals]);

  // Live figures between refreshes: rewards accrue per second on Monday–Friday.
  const live = useMemo(() => {
    let earnedTotal = 0; let perSecond = 0; let activeCapital = 0; let perDay = 0; let profitPerDay = 0;
    const rows = positions.map(position => {
      const until = Math.min(now, position.endsAt);
      const earningSeconds = until > position.startedAt ? businessSecondsUntil(until) - businessSecondsUntil(position.startedAt) : 0;
      const accrued = position.principal * position.rate / 100 * earningSeconds / DAY;
      const active = now < position.endsAt;
      const earned = position.compound ? (active ? accrued : position.totalPayout) : Math.min(position.totalPayout, accrued);
      const profitEarned = position.compound ? Math.min(earned, position.totalProfit) : earned / 2;
      const daysDone = Math.min(position.targetDays, earningSeconds / DAY);
      if (active) { activeCapital += position.principal; perDay += position.principal * position.rate / 100; profitPerDay += position.profitPerDay; perSecond += position.principal * position.rate / 100 / DAY; }
      earnedTotal += earned;
      const claimable = Math.max(0, earned - position.claimed);
      return { ...position, earned, profitEarned, active, claimable, daysDone, daysLeft: Math.max(0, Math.ceil(position.targetDays - daysDone)), progress: daysDone / position.targetDays * 100 };
    });
    const ticking = isEarningDay(now) && perSecond > 0;
    const pendingLive = Number(data.pending) + (ticking ? perSecond * Math.max(0, now - loadedAt.current) : 0);
    return { rows, earnedTotal, activeCapital, perDay, profitPerDay, capitalPerDay: perDay - profitPerDay, pendingLive, ticking };
  }, [positions, now, data.pending]);

  const totalClaimed = positions.reduce((sum, position) => sum + position.claimed, 0);
  const roiRows = live.rows.filter(row => !row.compound);
  const compoundRows = live.rows.filter(row => row.compound);
  const rowClaimable = (row) => row.claimable;
  const roiPending = roiRows.reduce((sum, row) => sum + rowClaimable(row), 0);
  const compoundPending = compoundRows.reduce((sum, row) => sum + rowClaimable(row), 0);
  // claimRoi settles every personal position in one transaction. The $5 minimum applies only
  // when the transaction contains no compound-position payout.
  const claimMinimumApplies = compoundPending <= 0;
  const canClaimPersonal = live.pendingLive > 0 && (!claimMinimumApplies || live.pendingLive >= MIN_CLAIM);
  const roiPrincipal = roiRows.reduce((sum, row) => sum + row.principal, 0);
  const compoundPrincipal = compoundRows.reduce((sum, row) => sum + row.principal, 0);
  const roiClaimed = roiRows.reduce((sum, row) => sum + row.claimed, 0);
  const compoundClaimed = compoundRows.reduce((sum, row) => sum + row.claimed, 0);
  const roiEarned = roiRows.reduce((sum, row) => sum + row.earned, 0);
  const compoundProfitEarned = compoundRows.reduce((sum, row) => sum + row.profitEarned, 0);
  const roiPerDay = roiRows.filter(row => row.active).reduce((sum, row) => sum + row.principal * row.rate / 100, 0);
  const compoundPerDay = compoundRows.filter(row => row.active).reduce((sum, row) => sum + row.profitPerDay, 0);
  const lockedCompound = compoundRows.filter(row => row.active).reduce((sum, row) => sum + row.principal, 0);
  const roiCapacity = roiRows.reduce((sum, row) => sum + row.totalPayout, 0);
  const compoundMaturityValue = compoundRows.reduce((sum, row) => sum + row.totalPayout, 0);
  const totalProfitEarned = roiEarned / 2 + compoundProfitEarned;
  const totalCapitalReleased = Math.max(0, live.earnedTotal - totalProfitEarned);
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
  const salaryAvailable = salaryClaimable * salaryPay;
  const salaryCycleEarned = salaryClaims * salaryPay;
  const salaryCycleMaximum = salaryPay * 6;
  const hasDirect = data.directA !== ethers.ZeroAddress || data.directB !== ethers.ZeroAddress;
  const earningToday = isEarningDay(now);
  const compoundMode = registered ? data.rewardMode === 1 : registrationMode === 1;
  const availablePlans = compoundMode ? compoundPlans : plans;
  const plan = availablePlans.find(item => item.index === selectedPlan) || availablePlans[0];
  useEffect(() => {
    if (plan && plan.index !== selectedPlan) setSelectedPlan(plan.index);
  }, [compoundMode, plan?.index, selectedPlan]);

  const steps = [
    { done: registered, label: "Join Vantex", hint: "One wallet confirmation", action: openRegistration, cta: "Join now" },
    { done: Number(data.balance) > 0 || positions.length > 0, label: "Get test mUSDT", hint: "Free tokens for the testnet", action: () => transact("mint"), cta: "Get 10,000" },
    { done: positions.length > 0, label: "Create your first position", hint: "Packages start at $1", action: () => setSection(compoundMode ? "compound" : "roi"), cta: "Choose package" },
    { done: hasDirect, label: "Invite your first member", hint: "Share your referral link", action: () => setSection("team"), cta: "Get link" }
  ];
  const stepsDone = steps.filter(step => step.done).length;
  const nextStep = steps.find(step => !step.done);

  const doRefresh = async () => { setRefreshing(true); try { await refresh?.(); if (section === "team") await fetchTeam(); if (section === "income") await fetchIncome(); } finally { setTimeout(() => setRefreshing(false), 400); } };
  const copy = async (text, key) => { try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(""), 1800); } catch {} };
  const shareText = "Join my team on Vantex Capital:";
  const nativeShare = async () => { try { await navigator.share({ title: "Vantex Capital", text: shareText, url: referralLink }); } catch {} };
  const noticeTone = notice && /added|claimed|compounded|confirmed|success|copied|is on|will now/i.test(notice) ? "success" : "error";

  const navigation = [
    ["overview", LayoutDashboard, "Overview"],
    ["roi", TrendingUp, "ROI"],
    ["compound", Repeat, "Compound"],
    ["salary", Crown, "Salary"],
    ["team", Network, "Team"],
    ["income", Layers, "ROI on ROI"]
  ];
  const titles = { overview: `${greeting()}.`, roi: "ROI income", compound: "Compound income", salary: "Salary income", team: "Your team", income: "ROI on ROI income" };

  // ---------- Reusable blocks ----------
  const ClaimCard = <section className="db-hero">
    <div className="db-hero-main">
      <span className="db-label"><Sparkles size={14}/> Available to claim</span>
      <strong className="db-hero-value">${money(live.pendingLive, live.ticking ? 4 : 2)}</strong>
      <p>{live.perDay > 0
        ? compoundMode
          ? <>Compound profit is claimable anytime; principal remains locked until maturity · {earningToday ? <span className="db-live"><i/>Accruing now</span> : <span className="db-paused">Weekend · resumes Monday</span>}</>
          : <>Profit <b>${money(live.profitPerDay)}</b> per earning day <span className="db-hero-sub">+ ${money(live.capitalPerDay)} capital returned</span> · {earningToday ? <span className="db-live"><i/>Accruing now</span> : <span className="db-paused">Weekend · resumes Monday</span>}</>
        : registered ? "Create a position to start earning Monday–Friday rewards." : "Join and create a position to start earning."}</p>
    </div>
    <div className="db-hero-actions">
      <button className="db-btn gold" disabled={busy || !account || !canClaimPersonal} onClick={() => transact("claimRoi")} title={claimMinimumApplies && live.pendingLive < MIN_CLAIM ? `Minimum claim is $${MIN_CLAIM}` : ""}><ArrowDownToLine size={17}/> Claim to wallet</button>
      {account && registered && claimMinimumApplies && live.pendingLive > 0 && live.pendingLive < MIN_CLAIM && <span className="db-claim-min">Minimum claim is ${MIN_CLAIM} · ${money(Math.max(0, MIN_CLAIM - live.pendingLive))} to go.</span>}
    </div>
    <div className="db-hero-glow"/>
  </section>;

  const InvestCard = <section className="db-card db-invest" id="new-position">
    <div className="db-card-head"><div><span className="db-eyebrow">Invest</span><h2>New position</h2></div><span className={`db-chip ${planColors[selectedPlan]}`}>{plan.name}</span></div>
    <label className="db-field-label">Amount <span>USDT</span></label>
    <div className="db-amount"><span>$</span><input type="number" min="1" max="2500" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} aria-label="Amount in USDT"/><button onClick={() => setAmount(String(Math.min(2500, Math.floor(Number(data.balance)))))} disabled={Number(data.balance) < 1}>Max</button></div>
    <div className="db-quick">{[100, 500, 1000, 2500].map(value => <button key={value} className={Number(amount) === value ? "active" : ""} onClick={() => setAmount(String(value))}>${value.toLocaleString()}</button>)}</div>
    <div className="db-plan-pick">{availablePlans.map(item => <button key={item.index} className={`${planColors[item.index]} ${plan.index === item.index ? "active" : ""}`} onClick={() => setSelectedPlan(item.index)}><b>{item.name} · {item.rate}</b><span>{item.days}</span></button>)}</div>
    {compoundMode ? <div className="db-summary">
      <div><span>Profit per earning day <small>{plan.rate} · Mon–Fri</small></span><b className="up">${money(Number(amount || 0) * plan.rateValue / 100)}</b></div>
      <div><span>Principal</span><b>${money(Number(amount || 0))} locked</b></div>
      <div><span>Term</span><b>{plan.days}</b></div>
      <div><span>Total package profit</span><b className="up">+${money(Math.max(0, projected - Number(amount || 0)))}</b></div>
      <div className="total"><span>At maturity <small>principal + full profit</small></span><b>${money(projected)}</b></div>
    </div> : <div className="db-summary">
      <div><span>Profit per day <small>{plan.rate} · Mon–Fri</small></span><b className="up">${money(Number(amount || 0) * plan.rateValue / 200)}</b></div>
      <div><span>Capital returned per day <small>{plan.rate}</small></span><b>${money(Number(amount || 0) * plan.rateValue / 200)}</b></div>
      <div><span>Term</span><b>{plan.days}</b></div>
      <div><span>Profit over the term</span><b className="up">+${money(Math.max(0, projected - Number(amount || 0)))}</b></div>
      <div className="total"><span>Total paid back <small>2× capital</small></span><b>${money(projected)}</b></div>
    </div>}
    {account && member && !registered && <div className="db-mini-pick">
      <span>Your plan</span>
      <div><button className={registrationMode === 0 ? "active" : ""} onClick={() => setRegistrationMode(0)}>ROI</button><button className={registrationMode === 1 ? "active" : ""} onClick={() => setRegistrationMode(1)}>Compound</button></div>
    </div>}
    {account && Number(data.balance) < Number(amount || 0) && <p className="db-inline-warn"><CircleAlert size={14}/> Your wallet has ${money(data.balance)} mUSDT. <button onClick={() => transact("mint")} disabled={busy}>Get test tokens</button></p>}
    <button className="db-btn dark full" disabled={busy} onClick={() => transact("invest")}>{busy ? "Processing…" : !account ? "Connect wallet to continue" : registered ? "Create position" : "Join & create position"}<ArrowUpRight size={17}/></button>
    <p className="db-fine">Estimates follow the contract terms and are not guaranteed.</p>
  </section>;

  const renderPositions = (limit, type = "all") => {
    const source = type === "roi" ? roiRows : type === "compound" ? compoundRows : live.rows;
    const rows = limit ? source.slice().reverse().slice(0, limit) : source.slice().reverse();
    const target = type === "compound" ? "compound" : "roi";
    if (!rows.length) return <div className="db-empty"><BriefcaseBusiness size={30}/><b>No {type === "all" ? "" : `${type} `}positions yet</b><span>Choose a package to create your first position.</span><button className="db-btn gold small" onClick={() => setSection(target)}>Choose a package</button></div>;
    return <div className="db-positions">{rows.map(row => <article key={row.index} className="db-position">
      <div className="db-position-top">
        <span className={`db-dot ${planColors[row.plan]}`}/>
        <div><b>{row.name}</b><small>#{String(row.index + 1).padStart(2, "0")} · started {dateLabel(row.startedAt)}</small></div>
        <em className={row.active ? "on" : "off"}>{row.active ? "Active" : "Completed"}</em>
      </div>
      <div className="db-position-stats">
        <div><span>Capital</span><b>${money(row.principal)}</b></div>
        <div><span>Total / day</span><b className="up">${money(row.principal * row.rate / 100)}</b><small>{row.rate.toFixed(2)}% · Mon–Fri</small></div>
        <div><span>Claimable now</span><b className="up">${money(row.claimable, row.claimable < 0.01 ? 4 : 2)}</b><small>Live contract payout</small></div>
        <div><span>Already claimed</span><b>${money(row.claimed)}</b></div>
        <div><span>Profit accrued</span><b className="up">${money(row.onchain?.profitAccrued ?? row.profitEarned)}</b></div>
        <div><span>Capital returned</span><b>${money(row.onchain?.capitalReturned ?? (row.compound ? Math.max(0, row.earned - row.profitEarned) : row.earned / 2))}</b></div>
        <div><span>Payout cap</span><b>${money(row.onchain?.maximumPayout ?? row.totalPayout)}</b></div>
        <div><span>{row.active ? "Days left" : "Ended"}</span><b>{row.active ? row.daysLeft : dateLabel(row.endsAt)}</b></div>
      </div>
      <Progress value={row.progress} tone={planColors[row.plan]}/>
      <small className="db-position-foot">{row.compound
        ? <>Compounding plan · {Math.floor(row.daysDone)} of {row.targetDays} earning days · ${money(row.claimed)} claimed of ${money(row.totalPayout)} (${money(row.totalProfit)} profit + ${money(row.principal)} capital at the end)</>
        : <>Started {dateLabel(row.startedAt)} · projected completion {dateLabel(row.endsAt)} · {Math.floor(row.daysDone)} of ≈{Math.ceil(row.targetDays)} earning days · 2× cap includes ${money(row.principal)} profit + ${money(row.principal)} returned capital</>}</small>
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
    <p className="db-fine">Levels and salary require 50:50 matched volume across A and B. Contributor counts may differ; only deposited volume matters.</p>
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
      <article><div className="db-stat-icon green"><TrendingUp size={18}/></div><span>Total earned</span><strong>${money(live.earnedTotal)}</strong><small>${money(totalProfitEarned)} profit + ${money(totalCapitalReleased)} capital · ${money(data.referralEarnings)} from team</small></article>
      <article><div className="db-stat-icon violet"><Users size={18}/></div><span>Balanced team volume</span><strong>${money(balanced, 0)}</strong><small>Level {data.level} of 15 unlocked</small></article>
    </section>

    <div className="db-grid">
      <section className="db-card">
        <div className="db-card-head"><div><span className="db-eyebrow">Portfolio</span><h2>Recent positions</h2></div>{live.rows.length > 0 && <button className="db-link-btn" onClick={() => setSection(compoundMode ? "compound" : "roi")}>View income <ArrowUpRight size={14}/></button>}</div>
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

  const roiView = <>
    <section className="db-income-hero db-roi-hero">
      <div className="db-income-main">
        <span className="db-label"><TrendingUp size={14}/> ROI available to claim</span>
        <strong className="db-hero-value">${money(roiPending, earningToday ? 4 : 2)}</strong>
        <p>{roiRows.length ? <>{roiRows.filter(row => row.active).length} active ROI position{roiRows.filter(row => row.active).length === 1 ? "" : "s"} · <b>${money(roiPerDay)}</b> total payout per earning day</> : "Choose an ROI package to begin earning toward its 2× payout cap."}</p>
      </div>
      <div className="db-income-stats">
        <div><span>Invested</span><b>${money(roiPrincipal)}</b></div>
        <div><span>Accrued payout</span><b>${money(roiEarned)}</b></div>
        <div><span>Already claimed</span><b>${money(roiClaimed)}</b></div>
        <div><span>Maximum payout</span><b>${money(roiCapacity)}</b></div>
      </div>
      <div className="db-hero-actions db-income-action">
        <button className="db-btn gold" disabled={busy || !canClaimPersonal} onClick={() => transact("claimRoi")}><ArrowDownToLine size={17}/> Claim ${money(live.pendingLive)} total</button>
        {compoundPending > 0 && <span className="db-claim-min">The contract settles all positions together: ${money(roiPending)} ROI + ${money(compoundPending)} compound.</span>}
      </div>
      <div className="db-hero-glow"/>
    </section>

    <section className="db-stats">
      <article><div className="db-stat-icon gold"><BriefcaseBusiness size={18}/></div><span>ROI capital</span><strong>${money(roiPrincipal)}</strong><small>{roiRows.length} position{roiRows.length === 1 ? "" : "s"}</small></article>
      <article><div className="db-stat-icon green"><TrendingUp size={18}/></div><span>Profit accrued</span><strong>${money(roiEarned / 2)}</strong><small>The other half is returned capital</small></article>
      <article><div className="db-stat-icon blue"><Coins size={18}/></div><span>Remaining to 2×</span><strong>${money(Math.max(0, roiCapacity - roiEarned))}</strong><small>Across every ROI position</small></article>
      <article><div className="db-stat-icon violet"><Layers size={18}/></div><span>Level income received</span><strong>${money(data.referralEarnings)}</strong><small>ROI mode cap: 3× wallet deposits</small></article>
    </section>

    {data.rewardMode !== 0 && registered && <div className="db-banner gold"><TrendingUp size={18}/><span><b>ROI mode is not selected.</b> Switch modes to create a new ROI position. Existing positions continue under their original terms.</span><button className="db-btn gold small" disabled={busy} onClick={() => transact("setRewardMode", 0)}>Switch to ROI</button></div>}
    <div className="db-grid">
      <section className="db-card"><div className="db-card-head"><div><span className="db-eyebrow">ROI portfolio</span><h2>{roiRows.length} position{roiRows.length === 1 ? "" : "s"}</h2></div><span className="db-chip">2× payout cap</span></div>{renderPositions(undefined, "roi")}</section>
      {(!registered || data.rewardMode === 0) && InvestCard}
    </div>
    <section className="db-card db-rules"><div className="db-card-head"><div><span className="db-eyebrow">ROI rules</span><h2>Income limits and timing</h2></div></div><div className="db-rule-grid">
      <div><b>2× personal payout</b><span>Each ROI position stops after paying twice its deposited principal.</span></div>
      <div><b>$5 minimum claim</b><span>Wallet ROI claims become available after at least $5 has accrued.</span></div>
      <div><b>3× level-income capacity</b><span>Every fresh wallet deposit adds three times its amount to ROI-on-ROI capacity.</span></div>
      <div><b>Monday–Friday</b><span>Returns accrue continuously on earning days and pause on weekends.</span></div>
    </div></section>
  </>;

  const compoundView = <>
    <section className="db-income-hero db-compound-hero">
      <div className="db-income-main">
        <span className="db-label"><Repeat size={14}/> Compound profit available</span>
        <strong className="db-hero-value">${money(compoundPending, earningToday ? 4 : 2)}</strong>
        <p>{compoundRows.length ? <><b>${money(compoundPerDay)}</b> profit per earning day · ${money(lockedCompound)} principal currently locked</> : "Choose Starter, Growth, or Elite to create your first compound position."}</p>
      </div>
      <div className="db-income-stats">
        <div><span>Compound capital</span><b>${money(compoundPrincipal)}</b></div>
        <div><span>Profit accrued</span><b>${money(compoundProfitEarned)}</b></div>
        <div><span>Already claimed</span><b>${money(compoundClaimed)}</b></div>
        <div><span>Full maturity value</span><b>${money(compoundMaturityValue)}</b></div>
      </div>
      <div className="db-hero-actions db-income-action"><button className="db-btn gold" disabled={busy || compoundPending <= 0} onClick={() => transact("claimRoi")}><ArrowDownToLine size={17}/> Withdraw profit</button></div>
      <div className="db-hero-glow"/>
    </section>

    <section className="db-plan-overview">{compoundPlans.map(item => <article key={item.index} className={item.color}>
      <span>{item.name}</span><strong>{item.rate}<small>/day</small></strong><b>{item.earningDays} earning days</b><small>{(item.rateValue * item.earningDays).toFixed(1)}% package profit · principal unlocks at maturity</small>
    </article>)}</section>

    {data.rewardMode !== 1 && registered && <div className="db-banner gold"><Repeat size={18}/><span><b>Compound mode is not selected.</b> Switch modes to choose Starter, Growth, or Elite. Existing ROI positions keep their original terms.</span><button className="db-btn gold small" disabled={busy} onClick={() => transact("setRewardMode", 1)}>Switch to Compound</button></div>}
    <div className="db-grid">
      <section className="db-card"><div className="db-card-head"><div><span className="db-eyebrow">Compound portfolio</span><h2>{compoundRows.length} position{compoundRows.length === 1 ? "" : "s"}</h2></div><span className="db-chip green">Profit anytime</span></div>{renderPositions(undefined, "compound")}</section>
      {(!registered || data.rewardMode === 1) && InvestCard}
    </div>
    <section className="db-card db-rules"><div className="db-card-head"><div><span className="db-eyebrow">Compound rules</span><h2>Withdrawals and principal</h2></div></div><div className="db-rule-grid">
      <div><b>Profit every earning second</b><span>Claim accrued profit anytime without waiting for a daily close.</span></div>
      <div><b>No $5 minimum</b><span>Any non-zero compound profit supported by token precision can be withdrawn.</span></div>
      <div><b>Principal stays locked</b><span>The original deposit unlocks only after 90, 150, or 200 earning days.</span></div>
      <div><b>Fixed selected package</b><span>Each position keeps the package rate and duration chosen when it was opened.</span></div>
    </div></section>
  </>;

  const salaryView = <>
    <section className="db-income-hero db-salary-hero">
      <div className="db-income-main">
        <span className="db-label"><Crown size={14}/> Salary available</span>
        <strong className="db-hero-value">${money(salaryAvailable)}</strong>
        <p>{salaryRank ? <>Rank {salaryRank} pays <b>${salaryPay}</b> every 15 days for six cycles.</> : "Build equal 50:50 volume across Organizations A and B to unlock salary income."}</p>
      </div>
      <div className="db-income-stats">
        <div><span>Current rank</span><b>{salaryRank || "–"}</b></div>
        <div><span>Current cycle claimed</span><b>${money(salaryCycleEarned)}</b></div>
        <div><span>Six-cycle maximum</span><b>${money(salaryCycleMaximum)}</b></div>
        <div><span>Balanced business</span><b>${money(balanced, 0)}</b></div>
      </div>
      <div className="db-hero-actions db-income-action"><button className="db-btn gold" disabled={busy || salaryClaimable <= 0} onClick={() => transact("claimSalary")}><ArrowDownToLine size={17}/> {salaryClaimable ? `Claim $${money(salaryAvailable, 0)}` : "No salary due"}</button></div>
      <div className="db-hero-glow"/>
    </section>

    <div className="db-grid even">{SalaryCard}{TeamVolumeCard}</div>
    <section className="db-card"><div className="db-card-head"><div><span className="db-eyebrow">Salary milestones</span><h2>50:50 qualification table</h2></div><span className="db-chip">6 payments each</span></div>
      <div className="db-salary-tiers">{salaryTiers.map((tier, index) => {
        const unlocked = balanced >= tier.need;
        const active = salaryRank === index + 1;
        return <article key={tier.need} className={`${unlocked ? "unlocked" : ""} ${active ? "active" : ""}`}>
          <span>Rank {index + 1}{active && <em>Current</em>}</span><strong>${tier.pay}<small>/cycle</small></strong><b>${tier.need.toLocaleString()} business</b><small>A ${money(tier.need / 2, 0)} + B ${money(tier.need / 2, 0)} · every 15 days</small><Progress value={Math.min(100, balanced / tier.need * 100)} tone={unlocked ? "green" : "blue"}/>
        </article>;
      })}</div>
      <p className="db-fine">When a higher rank is reached, its six-payment cycle begins from the qualification time. Deposited business counts; compound profit does not add team business.</p>
    </section>
  </>;

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

  const CompoundPlansCard = <section className="db-card db-cplans">
    <div className="db-card-head">
      <div><span className="db-eyebrow">Locked-principal packages</span><h2>Compound plans</h2></div>
      <span className={`db-chip ${data.rewardMode === 1 ? "green" : "gold"}`}>{data.rewardMode === 1 ? "Compound mode" : "ROI mode"}</span>
    </div>
    <p className="db-muted">Choose Starter, Growth, or Elite when creating a compound position. Profit accrues every earning second and is withdrawable anytime; principal remains locked until the selected term ends.</p>
    <p className="db-fine">Starter: 0.60% for 90 earning days · Growth: 0.65% for 150 · Elite: 0.70% for 200.</p>
  </section>;

  const rewards = <>
    {ClaimCard}
    {CompoundPlansCard}
    <div className="db-grid even">
      <section className="db-card">
        <div className="db-card-head"><div><span className="db-eyebrow">Reward mode</span><h2>How you receive ROI</h2></div><Coins size={20} className="db-gold"/></div>
        <div className="db-mode">
          <button className={data.rewardMode === 0 ? "active" : ""} disabled={busy || !registered || data.rewardMode === 0} onClick={() => transact("setRewardMode", 0)}><ArrowDownToLine size={18}/><b>Pay to my wallet</b><span>Claim whenever you like</span>{data.rewardMode === 0 && <CircleCheck size={16} className="db-mode-check"/>}</button>
          <button className={data.rewardMode === 1 ? "active" : ""} disabled={busy || !registered || data.rewardMode === 1} onClick={() => transact("setRewardMode", 1)}><Repeat size={18}/><b>Compound packages</b><span>Choose Starter, Growth, or Elite</span>{data.rewardMode === 1 && <CircleCheck size={16} className="db-mode-check"/>}</button>
        </div>
        <div className="db-kv"><span>Total claimed ROI</span><b>${money(totalClaimed)}</b></div>
        <div className="db-kv"><span>Team (ROI-on-ROI) earnings</span><b>${money(data.referralEarnings)} <button className="db-link-btn" onClick={() => setSection("income")}>Details <ArrowUpRight size={13}/></button></b></div>
      </section>
      {SalaryCard}
    </div>
  </>;

  // ---------- ROI on ROI income ----------
  const incomeData = income.data;
  const incomeLoading = income.status === "loading" && !incomeData;
  const incomeTotal = incomeData ? incomeData.total : Number(data.referralEarnings || 0);
  const payments = incomeData?.payments || [];
  const levelIncome = Array.from({ length: 15 }, (_, i) => incomeData?.levels?.[i] || { total: 0, lastPaidAt: 0, payments: 0 });
  const trackedTotal = levelIncome.reduce((sum, l) => sum + l.total, 0);
  const untracked = Math.max(0, incomeTotal - trackedTotal);
  const sumSince = (seconds) => payments.filter(p => p.paidAt >= seconds).reduce((sum, p) => sum + p.amount, 0);
  const startOfToday = (() => { const d = new Date(now * 1000); d.setHours(0, 0, 0, 0); return d.getTime() / 1000; })();
  const earnedToday = sumSince(startOfToday);
  const earned7 = sumSince(startOfToday - 6 * DAY);
  const earned30 = sumSince(startOfToday - 29 * DAY);
  const lastPayment = payments[0];
  const bestLevelIndex = levelIncome.reduce((best, l, i) => l.total > levelIncome[best].total ? i : best, 0);
  const chartDays = Array.from({ length: 14 }, (_, i) => {
    const start = startOfToday - (13 - i) * DAY;
    const amount = payments.filter(p => p.paidAt >= start && p.paidAt < start + DAY).reduce((sum, p) => sum + p.amount, 0);
    return { start, amount };
  });
  const chartMax = Math.max(...chartDays.map(d => d.amount), 0);
  const filteredPayments = incomeLevel ? payments.filter(p => p.level === incomeLevel) : payments;
  const visiblePayments = filteredPayments.slice(0, incomeShown);
  const paymentGroups = visiblePayments.reduce((groups, p) => {
    const key = dayKey(p.paidAt); const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(p); else groups.push({ key, heading: dayHeading(p.paidAt), items: [p] });
    return groups;
  }, []);
  const historySupported = incomeData ? incomeData.supported : true;

  const income_ = !registered ? <section className="db-card"><div className="db-empty"><Layers size={30}/><b>Join to earn ROI on ROI</b><span>When people in your team claim or compound their profit, you earn a share of it from up to 15 levels deep.</span><button className="db-btn gold small" onClick={openRegistration}>Join now</button></div></section> : <>
    <section className="db-income-hero">
      <div className="db-income-main">
        <span className="db-label"><Layers size={14}/> Total ROI on ROI earned</span>
        <strong className="db-hero-value">${money(incomeTotal)}</strong>
        <p>{lastPayment
          ? <>Last paid <b>${money(lastPayment.amount)}</b> from level {lastPayment.level} · {ago(lastPayment.paidAt, now)}</>
          : incomeTotal > 0 ? "Paid straight to your wallet each time your team claims or compounds." : "You'll earn here when members in your unlocked levels claim or compound their profit."}</p>
      </div>
      <div className="db-income-stats">
        <div><span>Today</span><b>${money(earnedToday)}</b></div>
        <div><span>Last 7 days</span><b>${money(earned7)}</b></div>
        <div><span>Last 30 days</span><b>${money(earned30)}</b></div>
        <div><span>Levels unlocked</span><b>{data.level} <small>of 15</small></b></div>
      </div>
      <div className="db-hero-glow"/>
    </section>

    {income.status === "error" && <p className="db-inline-warn"><CircleAlert size={14}/> {income.error} <button onClick={fetchIncome}>Try again</button></p>}
    {incomeData && !historySupported && <div className="db-banner"><CircleAlert size={18}/><span><b>History isn't available yet.</b> Your total is shown above. Per-level totals and payment dates appear once the contract upgrade is deployed.</span></div>}

    <div className="db-grid even">
      <section className="db-card">
        <div className="db-card-head">
          <div><span className="db-eyebrow">When</span><h2>Last 14 days</h2></div>
          <span className="db-chip green">${money(chartDays.reduce((sum, d) => sum + d.amount, 0))}</span>
        </div>
        <div className="db-income-chart" role="img" aria-label="ROI on ROI earned per day over the last 14 days">
          {chartDays.map(d => <div key={d.start} className={d.start === startOfToday ? "today" : ""} title={`${dateLabel(d.start)}: $${money(d.amount)}`}>
            <i style={{ height: chartMax ? `${Math.max(d.amount ? 6 : 0, d.amount / chartMax * 100)}%` : 0 }}/>
            <span>{new Date(d.start * 1000).toLocaleDateString("en-US", { day: "numeric" })}</span>
          </div>)}
        </div>
        <p className="db-fine">{chartMax ? "Tap or hover a bar to see that day's amount. Payments only happen when your team claims or compounds, which is usually Monday to Friday." : "No ROI on ROI in the last 14 days yet."}</p>
      </section>

      <section className="db-card">
        <div className="db-card-head"><div><span className="db-eyebrow">How it works</span><h2>Where it comes from</h2></div></div>
        <div className="db-kv"><span>Your best level</span><b>{levelIncome[bestLevelIndex].total > 0 ? `Level ${bestLevelIndex + 1} · $${money(levelIncome[bestLevelIndex].total)}` : "–"}</b></div>
        <div className="db-kv"><span>Payments received</span><b>{(incomeData?.count || 0).toLocaleString()}</b></div>
        <div className="db-kv"><span>Levels that paid you</span><b>{levelIncome.filter(l => l.payments > 0).length} of 15</b></div>
        {untracked > 0.000001 && <div className="db-kv"><span>Earned before history tracking</span><b>${money(untracked)}</b></div>}
        <p className="db-muted">Each time a member in your team claims or compounds, you get a percentage of the <b>profit half</b> of that ROI from their level. You only earn from levels you've unlocked at that moment.</p>
        {nextLevelTier && <button className="db-link-btn" onClick={() => setSection("team")}>Unlock levels {data.level + 1}–{nextLevelTier.upTo} at ${nextLevelTier.need.toLocaleString()} balanced volume <ArrowUpRight size={13}/></button>}
      </section>
    </div>

    <section className="db-card">
      <div className="db-card-head">
        <div><span className="db-eyebrow">Which level</span><h2>Earnings by level</h2></div>
        <button className="db-link-btn" onClick={fetchIncome} disabled={income.status === "loading"}>{income.status === "loading" ? <><Loader2 size={14} className="db-spin"/> Loading</> : <><RefreshCw size={14}/> Refresh</>}</button>
      </div>
      <div className="db-income-table" role="table" aria-label="ROI on ROI earnings per level">
        <div className="db-income-row head" role="row"><span>Level</span><span>Rate</span><span>Earned</span><span>Payments</span><span>Last paid</span></div>
        {levelIncome.map((l, index) => {
          const unlocked = index < data.level;
          const share = trackedTotal ? l.total / trackedTotal * 100 : 0;
          const active = incomeLevel === index + 1;
          return <button key={index} role="row" className={`db-income-row ${l.payments ? "has" : "empty"} ${active ? "active" : ""}`} disabled={!l.payments} onClick={() => { setIncomeLevel(active ? 0 : index + 1); setIncomeShown(30); }} title={l.payments ? "Show this level's payments" : ""}>
            <span className={unlocked ? "on" : "off"}>{unlocked ? <Unlock size={12}/> : <Lock size={12}/>} L{index + 1}</span>
            <span>{levels[index]}%</span>
            <span className="db-income-earned"><b>{incomeLoading ? "…" : `$${money(l.total)}`}</b>{share > 0 && <i style={{ width: `${share}%` }}/>}</span>
            <span>{l.payments || "–"}</span>
            <span>{l.lastPaidAt ? <>{dateLabel(l.lastPaidAt)}<small>{timeLabel(l.lastPaidAt)}</small></> : "–"}</span>
          </button>;
        })}
        <div className="db-income-row total" role="row"><span>Total</span><span/><span><b>${money(trackedTotal)}</b></span><span>{levelIncome.reduce((sum, l) => sum + l.payments, 0)}</span><span/></div>
      </div>
      <p className="db-fine">Rates are a share of the profit half of your team's ROI. Lock icons are levels you haven't unlocked yet. Tap a level to see only its payments.</p>
    </section>

    <section className="db-card">
      <div className="db-card-head">
        <div><span className="db-eyebrow">History</span><h2>{incomeLevel ? `Level ${incomeLevel} payments` : "All payments"}</h2></div>
        <select className="db-select" value={incomeLevel} onChange={event => { setIncomeLevel(Number(event.target.value)); setIncomeShown(30); }} aria-label="Filter by level">
          <option value={0}>All levels</option>
          {levelIncome.map((l, index) => <option key={index} value={index + 1}>Level {index + 1}{l.payments ? ` (${l.payments})` : ""}</option>)}
        </select>
      </div>
      {incomeData?.legacyError && untracked > 0.000001 && <p className="db-inline-warn"><CircleAlert size={14}/> Couldn't load ${money(untracked)} of older payments right now. They're included in your total. <button onClick={fetchIncome}>Try again</button></p>}
      {incomeLoading ? <div className="db-direct-list">{[0, 1, 2].map(i => <div key={i} className="db-direct-row skeleton"/>)}</div>
        : !filteredPayments.length ? <div className="db-direct-empty">
            <span className="db-slot-empty"><Layers size={18}/></span>
            <div><b>{incomeLevel ? `No payments from level ${incomeLevel} yet` : incomeTotal > 0 ? "Payment details couldn't be loaded" : "No ROI on ROI payments yet"}</b><small>{!incomeLevel && incomeTotal > 0 ? `Your $${money(incomeTotal)} total is correct; the list of individual payments will appear after a refresh.` : "Payments appear here as soon as someone in your unlocked levels claims or compounds."}</small></div>
            {incomeLevel > 0 && <button className="db-btn glass small" onClick={() => setIncomeLevel(0)}>Show all levels</button>}
          </div>
        : <div className="db-pay-list">
            {paymentGroups.map(group => <div key={group.key} className="db-pay-group">
              <div className="db-pay-day"><span>{group.heading}</span><b>+${money(group.items.reduce((sum, p) => sum + p.amount, 0))}</b></div>
              {group.items.map(p => <div key={p.id} className="db-pay-row">
                <span className="db-pay-level">L{p.level}</span>
                <div className="db-pay-from"><b>From {short(p.source)}</b><small>{timeLabel(p.paidAt)} · {levels[p.level - 1]}% of their profit</small></div>
                <a href={EXPLORER + p.source} target="_blank" rel="noreferrer" aria-label="View member on BscScan"><ExternalLink size={13}/></a>
                <b className="db-pay-amount">+${money(p.amount, p.amount < 0.01 ? 4 : 2)}</b>
              </div>)}
            </div>)}
            {filteredPayments.length > incomeShown && <button className="db-btn glass full" onClick={() => setIncomeShown(n => n + 30)}>Show more ({filteredPayments.length - incomeShown} left)</button>}
            {incomeData?.truncated && filteredPayments.length <= incomeShown && <p className="db-fine">Showing your latest {payments.length.toLocaleString()} payments. Older ones are included in the level totals above.</p>}
          </div>}
    </section>
  </>;

  const views = { overview, roi: roiView, compound: compoundView, salary: salaryView, team: teamView, income: income_ };

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
