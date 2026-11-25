import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ethers } from "ethers";
import Dashboard from "./Dashboard";
import Home from "./Home";
import RegistrationWizard from "./RegistrationWizard";
import { connectErrorMessage, isOnTestnet, lastWallet, rememberWallet, requestAccount, useWallets } from "./wallet";
import "./styles.css";

const CONTRACT_ADDRESS = import.meta.env.VITE_VANTEX_ADDRESS || "";
const TOKEN_ADDRESS = import.meta.env.VITE_TOKEN_ADDRESS || "";
const TOKEN_DECIMALS = Number(import.meta.env.VITE_TOKEN_DECIMALS || 6);
const ZERO = "0x0000000000000000000000000000000000000000";
const REFERRAL_PARAMS = new URLSearchParams(window.location.search);
const REF_STORAGE_KEY = "vantex-referral";
const storage = {
  get() { try { return JSON.parse(localStorage.getItem(REF_STORAGE_KEY) || "null"); } catch { return null; } },
  set(value) { try { localStorage.setItem(REF_STORAGE_KEY, JSON.stringify(value)); } catch {} },
  clear() { try { localStorage.removeItem(REF_STORAGE_KEY); } catch {} }
};
const QUERY_REFERRER = ethers.isAddress(REFERRAL_PARAMS.get("ref") || "") ? REFERRAL_PARAMS.get("ref") : "";
if (QUERY_REFERRER) storage.set({ ref: QUERY_REFERRER, leg: REFERRAL_PARAMS.get("leg") === "1" ? 1 : 0 });
// Remember the inviter across reloads so a refresh or wallet-app redirect doesn't lose the sponsor.
const STORED_REFERRAL = storage.get();
const LINK_REFERRER = QUERY_REFERRER || (ethers.isAddress(STORED_REFERRAL?.ref || "") ? STORED_REFERRAL.ref : "");
const LINK_LEG = QUERY_REFERRER ? (REFERRAL_PARAMS.get("leg") === "1" ? 1 : 0) : (STORED_REFERRAL?.leg === 1 ? 1 : 0);
// Used for read-only checks before a wallet is connected (e.g. verifying a referral link).
const BSC_RPC = import.meta.env.VITE_READ_RPC || "https://data-seed-prebsc-1-s1.bnbchain.org:8545";
const AUTO_OPEN_REGISTRATION = Boolean(QUERY_REFERRER) || REFERRAL_PARAMS.get("action") === "register";
// Set by the "Open in MetaMask / Trust Wallet" deep links: connect as soon as the page opens inside the wallet app.
const AUTO_CONNECT = REFERRAL_PARAMS.get("autoconnect") === "1";
const clearAutoConnectParam = () => {
  const url = new URL(window.location.href);
  url.searchParams.delete("autoconnect");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
};

const VANTEX_ABI = [
  "error AlreadyRegistered()",
  "error InvalidAmount()",
  "error InvalidReferrer()",
  "error InvalidSponsor()",
  "error BelowMinimumClaim(uint256 minimum)",
  "function MIN_CLAIM_USD() view returns (uint256)",
  "function sponsorOf(address) view returns (address)",
  "function directReferralCount(address) view returns (uint256)",
  "function directReferralsOf(address account,uint256 offset,uint256 limit) view returns (address[])",
  "function registerWithSponsor(address sponsor,address referrer,uint8 leg,uint8 split,uint8 mode)",
  "function registerAndInvestWithSponsor(address sponsor,address referrer,uint8 leg,uint8 split,uint8 mode,uint256 amount,uint8 plan,(uint256 deadline,uint8 v,bytes32 r,bytes32 s) permit)",
  "error LegOccupied()",
  "error Paused()",
  "error TooManyPositions()",
  "function members(address) view returns (address referrer,uint128 personalBusiness,uint128 legABusiness,uint128 legBBusiness,uint40 salaryStartedAt,uint8 salaryRank,uint8 salaryClaims,uint8 split,bool registered)",
  "function owner() view returns (address)",
  "function directLeg(address,uint8) view returns (address)",
  "function referralEarnings(address) view returns (uint256)",
  "function referralEarningsByLevel(address) view returns ((uint128 total,uint40 lastPaidAt,uint32 payments)[15])",
  "function referralPaymentCount(address) view returns (uint256)",
  "function referralPaymentsOf(address account,uint256 offset,uint256 limit) view returns ((uint128 amount,uint40 paidAt,uint8 level,address source)[])",
  "function rewardMode(address) view returns (uint8)",
  "function pendingRoi(address) view returns (uint256)",
  "function roiDetailsOf(address) view returns ((uint256 accruedPayout,uint256 claimedPayout,uint256 claimablePayout,uint256 profitAccrued,uint256 capitalReturned,uint256 maximumPayout,bool active)[])",
  "function compoundTerms(uint256 amount,uint8 plan) view returns (uint16 rate,uint32 earningDuration)",
  "function balancedBusiness(address) view returns (uint256)",
  "function qualifiedLevel(address) view returns (uint8)",
  "function positionsOf(address) view returns (tuple(uint128 principal,uint128 claimed,uint40 startedAt,uint40 endsAt,uint16 dailyRateBps,uint8 plan)[])",
  "function register(address referrer,uint8 leg,uint8 split)",
  "function registerWithMode(address referrer,uint8 leg,uint8 split,uint8 mode)",
  "function invest(uint256 amount,uint8 plan)",
  "function investWithPermit(uint256 amount,uint8 plan,uint256 deadline,uint8 v,bytes32 r,bytes32 s)",
  "function registerAndInvestWithPermit(address referrer,uint8 leg,uint8 split,uint256 amount,uint8 plan,uint256 deadline,uint8 v,bytes32 r,bytes32 s)",
  "function registerAndInvestWithPermitAndMode(address referrer,uint8 leg,uint8 split,uint8 mode,uint256 amount,uint8 plan,uint256 deadline,uint8 v,bytes32 r,bytes32 s)",
  "function claimRoi()",
  "function claimSalary()",
  "function setRewardMode(uint8 mode)"
];
const TOKEN_ABI = [
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function name() view returns (string)",
  "function nonces(address) view returns (uint256)",
  "function mint(address,uint256)"
];

const plans = [
  { name: "Package 1", label: "$1 — $100", rate: "0.50%", totalRate: "1.00%", rateValue: 1.00, min: 1, max: 100, earningDays: 200, days: "200 earning days · Mon–Fri", color: "gold", index: 0, copy: "1.00% total per earning day until the position reaches its 2× payout cap." },
  { name: "Package 2", label: "$101 — $500", rate: "0.55%", totalRate: "1.10%", rateValue: 1.10, min: 101, max: 500, earningDays: 182, days: "≈182 earning days · Mon–Fri", color: "blue", index: 1, copy: "1.10% total per earning day until the position reaches its 2× payout cap." },
  { name: "Package 3", label: "$501 — $1,000", rate: "0.60%", totalRate: "1.20%", rateValue: 1.20, min: 501, max: 1000, earningDays: 167, days: "≈167 earning days · Mon–Fri", color: "purple", index: 2, copy: "1.20% total per earning day until the position reaches its 2× payout cap." },
  { name: "Package 4", label: "$1,001 — $2,500", rate: "0.65%", totalRate: "1.30%", rateValue: 1.30, min: 1001, max: 2500, earningDays: 154, days: "≈154 earning days · Mon–Fri", color: "green", index: 3, copy: "1.30% total per earning day until the position reaches its 2× payout cap." }
];

const compoundPlans = [
  { name: "Starter", label: "$1 — $2,500", rate: "0.60%", rateValue: 0.60, min: 1, max: 2500, earningDays: 90, days: "90 earning days · Mon–Fri", color: "blue", index: 4 },
  { name: "Growth", label: "$1 — $2,500", rate: "0.65%", rateValue: 0.65, min: 1, max: 2500, earningDays: 150, days: "150 earning days · Mon–Fri", color: "green", index: 5 },
  { name: "Elite", label: "$1 — $2,500", rate: "0.70%", rateValue: 0.70, min: 1, max: 2500, earningDays: 200, days: "200 earning days · Mon–Fri", color: "purple", index: 6 }
];
const allPlans = [...plans, ...compoundPlans];

const levels = [10, 5, 4, 3, 3, 3, 2, 2, 1, 1, 2, 2, 3, 4, 5];

const walletErrorCodeIsNetwork = (error) => error?.code === "WRONG_NETWORK";

const friendlyError = (error) => {
  if (error?.code === "ACTION_REJECTED") return "Transaction cancelled in your wallet.";
  const revertName = error?.revert?.name;
  if (revertName === "BelowMinimumClaim") return "The minimum claim is $5. Wait until your rewards reach $5, or compound them instead.";
  if (revertName === "InvalidSponsor") return "Your referrer couldn't be credited for this spot. Refresh and try again.";
  if (revertName === "InvalidReferrer") return "No valid sponsor placement was found. Refresh and try registration again.";
  if (revertName === "LegOccupied") return "That sponsor placement was just taken. Click register again to select another open placement.";
  if (revertName === "AlreadyRegistered") return "This wallet is already registered. Refreshing your account data should unlock investing.";
  if (revertName === "InvalidAmount") return "The amount does not match the selected package range.";
  if (revertName === "Paused") return "Transactions are temporarily paused by the contract owner.";
  if (revertName === "TooManyPositions") return "This wallet has reached the maximum number of positions.";
  const message = error?.shortMessage || error?.reason || error?.message || "Transaction failed.";
  if (/insufficient funds/i.test(message)) return "You need BSC Testnet BNB in this wallet to pay transaction gas.";
  return message;
};

function App() {
  const [route, setRoute] = useState(window.location.hash === "#/dashboard" ? "dashboard" : "home");
  const [account, setAccount] = useState("");
  const [provider, setProvider] = useState(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("100");
  const [selectedPlan, setSelectedPlan] = useState(0);
  const [referrer, setReferrer] = useState(LINK_REFERRER);
  const [leg, setLeg] = useState(LINK_LEG);
  const [registrationMode, setRegistrationMode] = useState(0);
  const [data, setData] = useState({ balance: "0", gas: null, pending: "0", business: "0", referralEarnings: "0", rewardMode: 0, level: 0, member: null, positions: [], roiDetails: [], directA: ZERO, directB: ZERO });
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [registrationStage, setRegistrationStage] = useState("idle");
  const [registrationError, setRegistrationError] = useState("");
  const [registrationTx, setRegistrationTx] = useState("");
  const [placementReady, setPlacementReady] = useState(false);
  const [placementError, setPlacementError] = useState("");
  // The inviter can come from the link, from storage, or be pasted into the join window later.
  const [inviter, setInviterState] = useState({ ref: LINK_REFERRER, leg: LINK_LEG });
  const inviterRef = useRef(inviter);
  const setInviter = (next) => { inviterRef.current = next; setInviterState(next); };
  const [joinFee, setJoinFee] = useState(null);
  const [walletChecked, setWalletChecked] = useState(false);
  const [walletProvider, setWalletProvider] = useState(null);
  const [connectStage, setConnectStage] = useState("idle");
  const [connectError, setConnectError] = useState("");
  const wallets = useWallets();
  const walletsRef = useRef(wallets);
  walletsRef.current = wallets;
  const autoOpened = useRef(false);
  const isConfigured = ethers.isAddress(CONTRACT_ADDRESS) && ethers.isAddress(TOKEN_ADDRESS);

  const signerContract = async () => new ethers.Contract(CONTRACT_ADDRESS, VANTEX_ABI, await provider.getSigner());
  // Breadth-first search for the next open slot, querying each tree level in parallel.
  const findOpenPlacement = async (reader, startingSponsor = "") => {
    let level = [startingSponsor || await reader.owner()];
    const visited = new Set();
    while (level.length && visited.size < 512) {
      level = level.filter(sponsor => {
        const key = sponsor.toLowerCase();
        if (sponsor === ZERO || visited.has(key)) return false;
        visited.add(key);
        return true;
      });
      const legs = await Promise.all(level.map(sponsor => Promise.all([reader.directLeg(sponsor, 0), reader.directLeg(sponsor, 1)])));
      for (let i = 0; i < level.length; i++) {
        if (legs[i][0] === ZERO) return { referrer: level[i], leg: 0 };
        if (legs[i][1] === ZERO) return { referrer: level[i], leg: 1 };
      }
      level = legs.flat();
    }
    throw new Error("No open sponsor placement is currently available.");
  };

  const selectRegistrationPlacement = async (reader) => {
    const { ref: inviteRef, leg: inviteLeg } = inviterRef.current;
    if (inviteRef) {
      const [sponsor, legA, legB] = await Promise.all([
        reader.members(inviteRef), reader.directLeg(inviteRef, 0), reader.directLeg(inviteRef, 1)
      ]);
      if (!sponsor.registered) throw new Error("This invite link doesn't belong to an active member. Ask your sponsor to check their link.");
      const preferredOccupant = inviteLeg === 0 ? legA : legB;
      if (preferredOccupant === ZERO) return { referrer: inviteRef, leg: inviteLeg };
      // Keep spillover inside the organization selected during registration. Once the sponsor's
      // direct A/B spot is filled, search below that branch instead of crossing to the other side.
      return findOpenPlacement(reader, preferredOccupant);
    }
    if (ethers.isAddress(referrer) && referrer !== ZERO) {
      const [sponsor, occupant] = await Promise.all([reader.members(referrer), reader.directLeg(referrer, leg)]);
      if (sponsor.registered && occupant === ZERO) return { referrer, leg };
    }
    return findOpenPlacement(reader);
  };

  const load = async (activeProvider = provider, activeAccount = account) => {
    if (!activeProvider || !activeAccount || !isConfigured) return;
    try {
      const reader = new ethers.Contract(CONTRACT_ADDRESS, VANTEX_ABI, activeProvider);
      const token = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, activeProvider);
      const referralTotalPromise = reader.referralEarnings(activeAccount).catch(() => 0n);
      const rewardModePromise = reader.rewardMode(activeAccount).catch(() => 0n);
      // Older proxy deployments do not have roiDetailsOf yet, so keep positionsOf as a safe fallback.
      const roiDetailsPromise = reader.roiDetailsOf(activeAccount).catch(() => []);
      const [member, pending, business, referralTotal, memberRewardMode, level, positions, roiDetails, balance, directA, directB, gas] = await Promise.all([
        reader.members(activeAccount), reader.pendingRoi(activeAccount), reader.balancedBusiness(activeAccount),
        referralTotalPromise, rewardModePromise, reader.qualifiedLevel(activeAccount), reader.positionsOf(activeAccount), roiDetailsPromise,
        token.balanceOf(activeAccount), reader.directLeg(activeAccount, 0), reader.directLeg(activeAccount, 1),
        activeProvider.getBalance(activeAccount).catch(() => null)
      ]);
      if (member.registered) storage.clear();
      setData({ member, gas, pending: ethers.formatUnits(pending, TOKEN_DECIMALS), business: ethers.formatUnits(business, TOKEN_DECIMALS), referralEarnings: ethers.formatUnits(referralTotal, TOKEN_DECIMALS), rewardMode: Number(memberRewardMode), level: Number(level), positions, roiDetails, balance: ethers.formatUnits(balance, TOKEN_DECIMALS), directA, directB });
      if (!member.registered) {
        setPlacementReady(false);
        try {
          const placement = await selectRegistrationPlacement(reader);
          setReferrer(placement.referrer);
          setLeg(placement.leg);
          setPlacementError("");
        } catch (error) { setPlacementError(friendlyError(error)); }
        finally { setPlacementReady(true); }
      }
      return member;
    } catch (error) { setNotice(friendlyError(error)); }
  };

  // Silently restore a previously authorized wallet so returning visitors skip the connect prompt.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const list = walletsRef.current;
        const remembered = list.find(wallet => wallet.id === lastWallet()) || list[0];
        if (!remembered) return;
        const eth = remembered.provider;
        const [accounts, chainId] = await Promise.all([eth.request({ method: "eth_accounts" }), eth.request({ method: "eth_chainId" })]);
        if (cancelled) return;
        if (AUTO_CONNECT && (!accounts?.[0] || !isOnTestnet(chainId))) { clearAutoConnectParam(); await connect(eth); return; }
        if (!accounts?.[0]) return;
        setWalletProvider(eth);
        if (!isOnTestnet(chainId)) { setConnectError("Your wallet is on a different network. Switch to BSC Testnet to continue."); return; }
        const restored = new ethers.BrowserProvider(eth);
        setProvider(restored); setAccount(accounts[0]);
        await load(restored, accounts[0]);
      } catch {} finally { if (!cancelled) setWalletChecked(true); }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  // Invited visitors land straight in the registration flow.
  useEffect(() => {
    if (autoOpened.current || !AUTO_OPEN_REGISTRATION || !walletChecked) return;
    if (account && !data.member) return;
    autoOpened.current = true;
    if (!data.member?.registered) setRegistrationOpen(true);
  }, [walletChecked, account, data.member]);

  const openRegistration = useCallback(() => {
    setRegistrationError("");
    setRegistrationStage(stage => (stage === "error" ? "idle" : stage));
    setRegistrationOpen(true);
  }, []);
  const closeRegistration = useCallback(() => setRegistrationOpen(false), []);

  // `mode` lets the ROI / Compound join buttons register with the plan that was just tapped.
  const registerMember = async (session, mode) => {
    const joinMode = mode ?? registrationMode;
    const activeProvider = session?.provider || provider;
    const activeAccount = session?.account || account;
    if (!activeAccount) return connectAndRegister(undefined, joinMode);
    if (!isConfigured) return;
    setBusy(true); setRegistrationError(""); setRegistrationTx("");
    try {
      const signer = await activeProvider.getSigner();
      const contract = new ethers.Contract(CONTRACT_ADDRESS, VANTEX_ABI, signer);
      // No gas yet: show the faucet and resume automatically once tBNB arrives.
      if ((await activeProvider.getBalance(activeAccount)) === 0n) { setRegistrationStage("gas"); return; }
      // If someone takes the chosen slot first, pick the next open one and retry automatically.
      for (let attempt = 0; ; attempt++) {
        setRegistrationStage("placing");
        const placement = await selectRegistrationPlacement(contract);
        setReferrer(placement.referrer); setLeg(placement.leg);
        try {
          await registerCall(contract, placement, joinMode, true);
          setRegistrationStage("wallet");
          const tx = await registerCall(contract, placement, joinMode);
          setRegistrationTx(tx.hash);
          setRegistrationStage("mining");
          await tx.wait();
          break;
        } catch (error) {
          if (error?.code === "ACTION_REJECTED") throw error;
          const revertName = error?.revert?.name;
          const nowRegistered = await contract.members(activeAccount).then(member => member.registered).catch(() => false);
          if (revertName === "AlreadyRegistered" || nowRegistered) break;
          const placementTaken = revertName === "LegOccupied" || revertName === "InvalidReferrer" || (error?.code === "CALL_EXCEPTION" && error?.receipt);
          if (placementTaken && attempt < 2) continue;
          throw error;
        }
      }
      storage.clear();
      if (QUERY_REFERRER) window.history.replaceState(null, "", `${window.location.pathname}${window.location.hash}`);
      setRegistrationStage("done");
      await load(activeProvider, activeAccount);
    } catch (error) {
      setRegistrationStage("error");
      setRegistrationError(friendlyError(error));
    } finally { setBusy(false); }
  };

  // True once the live contract is confirmed to have the sponsor upgrade.
  const sponsorSupport = useRef(false);
  const supportsSponsor = async (reader) => {
    if (sponsorSupport.current) return true;
    try { await reader.directReferralCount(ZERO); sponsorSupport.current = true; return true; } catch { return false; }
  };
  // Registers crediting the inviter as sponsor when the contract supports it; otherwise uses the original function.
  const registerCall = async (contract, placement, mode, estimateOnly = false) => {
    const withSponsor = await supportsSponsor(contract);
    const fn = withSponsor ? contract.registerWithSponsor : contract.registerWithMode;
    // The deployed ABI retains this legacy argument for proxy compatibility; qualification is
    // always 50:50 and the value has no effect.
    const args = withSponsor
      ? [inviterRef.current.ref || ZERO, placement.referrer, placement.leg, 0, mode]
      : [placement.referrer, placement.leg, 0, mode];
    return estimateOnly ? fn.estimateGas(...args) : fn(...args);
  };

  // Read-only contract access that also works before a wallet is connected.
  const readContract = () => new ethers.Contract(CONTRACT_ADDRESS, VANTEX_ABI, provider || new ethers.JsonRpcProvider(BSC_RPC));

  // Runs async work over a list in small parallel batches so public RPCs don't rate-limit us.
  const mapInChunks = async (items, size, fn) => {
    const out = [];
    for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
    return out;
  };

  // Payments made before the contract stored ROI-on-ROI history only exist as ReferralPaid events.
  // Most public BSC Testnet nodes refuse log queries, so a node that serves them is used for this one range.
  const LOG_RPC = import.meta.env.VITE_LOG_RPC || "https://bsc-prebsc-dataseed.bnbchain.org";
  const LEGACY_FROM = Number(import.meta.env.VITE_LEGACY_FROM_BLOCK || 143762151);
  const LEGACY_TO = Number(import.meta.env.VITE_LEGACY_TO_BLOCK || 144549833);
  const LOG_SPAN = 5000;
  const loadLegacyRoiPayments = async (account) => {
    const cacheKey = `vantex-legacy-roi:${CONTRACT_ADDRESS}:${account}`.toLowerCase();
    try { const cached = JSON.parse(localStorage.getItem(cacheKey) || "null"); if (Array.isArray(cached)) return cached; } catch {}
    const logProvider = new ethers.JsonRpcProvider(LOG_RPC, 97, { staticNetwork: true });
    const iface = new ethers.Interface(["event ReferralPaid(address indexed earner, address indexed source, uint8 level, uint256 amount)"]);
    const topics = [iface.getEvent("ReferralPaid").topicHash, ethers.zeroPadValue(account, 32)];
    const ranges = [];
    for (let block = LEGACY_FROM; block <= LEGACY_TO; block += LOG_SPAN) ranges.push([block, Math.min(LEGACY_TO, block + LOG_SPAN - 1)]);
    const fetchRange = async ([fromBlock, toBlock]) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try { return await logProvider.getLogs({ address: CONTRACT_ADDRESS, topics, fromBlock, toBlock }); }
        catch { await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1))); }
      }
      throw new Error("log range failed");
    };
    const logs = (await mapInChunks(ranges, 10, fetchRange)).flat();
    const blocks = [...new Set(logs.map(log => log.blockNumber))];
    const stamps = new Map(await mapInChunks(blocks, 10, async number => [number, (await logProvider.getBlock(number)).timestamp]));
    const payments = logs.map(log => {
      const event = iface.parseLog(log);
      return {
        id: `legacy-${log.transactionHash}-${log.index}`,
        amount: Number(ethers.formatUnits(event.args.amount, TOKEN_DECIMALS)),
        paidAt: Number(stamps.get(log.blockNumber)),
        level: Number(event.args.level),
        source: event.args.source,
        legacy: true
      };
    });
    try { localStorage.setItem(cacheKey, JSON.stringify(payments)); } catch {}
    return payments;
  };

  // ROI-on-ROI income: totals per level and the most recent payments (newest first).
  const ROI_HISTORY_LIMIT = 1000;
  const loadRoiIncome = async (account) => {
    if (!account || !isConfigured) return null;
    const reader = readContract();
    const total = Number(ethers.formatUnits(await reader.referralEarnings(account), TOKEN_DECIMALS));
    let byLevel; let count;
    try {
      [byLevel, count] = await Promise.all([reader.referralEarningsByLevel(account), reader.referralPaymentCount(account)]);
    } catch {
      return { supported: false, total, levels: [], payments: [], count: 0, truncated: false, loadedAt: Date.now() };
    }
    count = Number(count);
    const start = Math.max(0, count - ROI_HISTORY_LIMIT);
    const offsets = [];
    for (let offset = start; offset < count; offset += 200) offsets.push(offset);
    const pages = await mapInChunks(offsets, 4, offset => reader.referralPaymentsOf(account, offset, 200));
    const payments = pages.flat().map((p, i) => ({
      id: start + i,
      amount: Number(ethers.formatUnits(p.amount, TOKEN_DECIMALS)),
      paidAt: Number(p.paidAt),
      level: Number(p.level),
      source: p.source
    })).reverse();
    const levels = Array.from(byLevel, entry => ({
      total: Number(ethers.formatUnits(entry.total, TOKEN_DECIMALS)),
      lastPaidAt: Number(entry.lastPaidAt),
      payments: Number(entry.payments)
    }));
    // Earnings the contract has no stored record for were paid before history tracking: recover them from events.
    const tracked = levels.reduce((sum, level) => sum + level.total, 0);
    let legacyError = false;
    if (total - tracked > 1e-6) {
      try {
        const legacy = await loadLegacyRoiPayments(account);
        for (const payment of legacy) {
          const level = levels[payment.level - 1];
          if (!level) continue;
          level.total += payment.amount;
          level.payments += 1;
          level.lastPaidAt = Math.max(level.lastPaidAt, payment.paidAt);
        }
        payments.push(...legacy.sort((a, b) => b.paidAt - a.paidAt));
        count += legacy.length;
      } catch { legacyError = true; }
    }
    return { supported: true, total, levels, payments, count, truncated: count > ROI_HISTORY_LIMIT, legacyError, loadedAt: Date.now() };
  };

  // Walks the member's placement tree level by level (up to 15 levels, the ROI-on-ROI depth).
  // Each member records which of the root's organizations (A = 0, B = 1) they sit in.
  const TEAM_LIMIT = 1500;
  const loadTeam = async (root) => {
    if (!root || !isConfigured) return null;
    const reader = readContract();
    const levels = [];
    let frontier = [{ address: root, side: null }];
    let total = 0; let truncated = false;
    for (let depth = 1; depth <= 15 && frontier.length; depth++) {
      const legs = await mapInChunks(frontier, 40, node => Promise.all([reader.directLeg(node.address, 0), reader.directLeg(node.address, 1)]));
      const next = [];
      frontier.forEach((node, i) => [0, 1].forEach(sideIndex => {
        const child = legs[i][sideIndex];
        if (child !== ZERO) next.push({ address: child, parent: node.address, side: depth === 1 ? sideIndex : node.side, slot: sideIndex, level: depth });
      }));
      if (!next.length) break;
      const infos = await mapInChunks(next, 40, member => reader.members(member.address));
      next.forEach((member, i) => { member.deposit = Number(ethers.formatUnits(infos[i].personalBusiness, TOKEN_DECIMALS)); });
      levels.push(next);
      total += next.length;
      if (total >= TEAM_LIMIT) { truncated = true; break; }
      frontier = next;
    }
    // Direct referrals = members who joined with this member's invite (link or wallet address).
    const placed = new Map(levels.flat().map(member => [member.address.toLowerCase(), member]));
    let directs; let directsSource = "placement";
    if (await supportsSponsor(reader)) {
      directsSource = "sponsor";
      const count = Number(await reader.directReferralCount(root));
      const addresses = [];
      for (let offset = 0; offset < Math.min(count, TEAM_LIMIT); offset += 200) addresses.push(...await reader.directReferralsOf(root, offset, 200));
      // Members who joined before the upgrade have no sponsor record: their placement parent counts as sponsor.
      const legacy = await mapInChunks(levels[0] || [], 40, async member => (await reader.sponsorOf(member.address)) === ZERO ? member.address : null);
      const all = [...legacy.filter(Boolean), ...addresses];
      const unique = [...new Map(all.map(address => [address.toLowerCase(), address])).values()];
      const missing = unique.filter(address => !placed.has(address.toLowerCase()));
      const missingInfo = await mapInChunks(missing, 40, address => reader.members(address));
      const extra = new Map(missing.map((address, i) => [address.toLowerCase(), Number(ethers.formatUnits(missingInfo[i].personalBusiness, TOKEN_DECIMALS))]));
      directs = unique.map(address => {
        const inTree = placed.get(address.toLowerCase());
        return inTree ? { ...inTree } : { address, deposit: extra.get(address.toLowerCase()) || 0, level: null, side: null, parent: null };
      });
    } else {
      directs = (levels[0] || []).map(member => ({ ...member }));
    }
    return { levels, total, truncated, directs, directsSource, loadedAt: Date.now() };
  };

  // Validates a referral link or a plain referrer wallet address without applying it.
  // Returns { address, leg, slots } on success or { error } with a plain-language reason.
  const checkReferrer = async (input) => {
    const text = (input || "").trim();
    let ref = text; let linkLeg = 0;
    if (/^https?:\/\//i.test(text)) {
      try {
        const url = new URL(text);
        ref = url.searchParams.get("ref") || ""; linkLeg = url.searchParams.get("leg") === "1" ? 1 : 0;
      } catch { return { error: "That link looks incomplete. Copy the full invite link again." }; }
      if (!ref) return { error: "This link has no referrer in it. Ask your referrer for their invite link or wallet address." };
    }
    if (!ethers.isAddress(ref)) {
      return { error: /^0x[0-9a-f]*$/i.test(ref) && ref.length < 42
        ? `Wallet addresses have 42 characters. This one has ${ref.length}.`
        : "That isn't a valid wallet address. It should start with 0x." };
    }
    const address = ethers.getAddress(ref);
    if (account && address.toLowerCase() === account.toLowerCase()) return { error: "That's your own wallet. Enter the address of the person who referred you." };
    if (!isConfigured) return { address, leg: linkLeg, slots: null };
    try {
      const reader = readContract();
      const [member, legA, legB] = await Promise.all([reader.members(address), reader.directLeg(address, 0), reader.directLeg(address, 1)]);
      if (!member.registered) return { error: "This wallet isn't a Vantex member yet. Check the address with your referrer." };
      return { address, leg: linkLeg, slots: { a: legA === ZERO, b: legB === ZERO } };
    } catch {
      return { error: "Couldn't check this address right now. Check your connection and try again.", retryable: true };
    }
  };

  // Applies a referral link or referrer wallet address (empty input = no referrer, automatic placement).
  const applyInvite = async (input, legChoice) => {
    const text = (input || "").trim();
    if (!text) { setInviter({ ref: "", leg: 0 }); storage.clear(); setPlacementError(""); await refreshPlacement(); return ""; }
    const result = await checkReferrer(text);
    if (result.error) return result.error;
    const next = { ref: result.address, leg: legChoice ?? result.leg };
    setInviter(next); storage.set(next);
    await refreshPlacement();
    return "";
  };


  const refreshPlacement = async () => {
    if (!provider || !isConfigured) return;
    setPlacementReady(false);
    try {
      const placement = await selectRegistrationPlacement(new ethers.Contract(CONTRACT_ADDRESS, VANTEX_ABI, provider));
      setReferrer(placement.referrer); setLeg(placement.leg); setPlacementError("");
    } catch (error) { setPlacementError(friendlyError(error)); }
    finally { setPlacementReady(true); }
  };

  // Let people pick a different account without disconnecting (wallets that support it show their account picker).
  const switchAccount = async () => {
    try { await walletProvider?.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] }); } catch {}
  };

  // Show the real network fee before anyone clicks Join.
  useEffect(() => {
    setJoinFee(null);
    if (!registrationOpen || !provider || !account || !placementReady || placementError || data.member?.registered || !isConfigured) return;
    let cancelled = false;
    (async () => {
      try {
        const contract = new ethers.Contract(CONTRACT_ADDRESS, VANTEX_ABI, await provider.getSigner());
        const [gas, fees] = await Promise.all([
          registerCall(contract, { referrer, leg }, registrationMode, true),
          provider.getFeeData()
        ]);
        const price = fees.gasPrice || fees.maxFeePerGas || 0n;
        if (!cancelled) setJoinFee(gas * price);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [registrationOpen, provider, account, placementReady, placementError, referrer, leg, registrationMode, data.member]);

  const connect = async (chosen) => {
    const list = walletsRef.current;
    const eth = chosen?.request ? chosen : walletProvider || (list.length === 1 ? list[0].provider : null);
    // No wallet, or several to pick from: the registration window guides the visitor.
    if (!eth) { setConnectError(""); setRegistrationOpen(true); return; }
    setConnectError("");
    try {
      const nextAccount = await requestAccount(eth, setConnectStage);
      const match = list.find(wallet => wallet.provider === eth);
      if (match) rememberWallet(match.id);
      setConnectStage("loading");
      const nextProvider = new ethers.BrowserProvider(eth);
      setWalletProvider(eth); setProvider(nextProvider); setAccount(nextAccount); setNotice("");
      const member = await load(nextProvider, nextAccount);
      return { provider: nextProvider, account: nextAccount, member };
    } catch (error) {
      if (walletErrorCodeIsNetwork(error)) setWalletProvider(eth);
      setConnectError(connectErrorMessage(error));
      if (!registrationOpen) setNotice(connectErrorMessage(error));
      return null;
    } finally { setConnectStage("idle"); }
  };

  // Free test tokens for the testnet, used from the join window's success screen.
  // Returns an error message, or "" when the tokens arrived.
  const mintTestUsdt = async (session) => {
    const activeProvider = session?.provider || provider;
    const activeAccount = session?.account || account;
    if (!activeAccount || !activeProvider || !isConfigured) return "Connect your wallet first.";
    try {
      const token = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, await activeProvider.getSigner());
      const tx = await token.mint(activeAccount, ethers.parseUnits("10000", TOKEN_DECIMALS));
      await tx.wait();
      await load(activeProvider, activeAccount);
      return "";
    } catch (error) { return friendlyError(error); }
  };

  // Home page version: connects the wallet first if needed, then mints. Anyone can mint; joining isn't required.
  const mintFromHome = async () => {
    if (!isConfigured) return "Test tokens are available once the contracts are configured.";
    const session = account && provider ? { provider, account } : await connect();
    if (!session) return "Connect your wallet to get test tokens.";
    return mintTestUsdt(session);
  };

  // One tap: connect, switch network and register without stopping in between.
  const connectAndRegister = async (chosen, mode) => {
    const session = account && provider ? { provider, account } : await connect(chosen);
    if (!session || session.member?.registered) return;
    await registerMember(session, mode);
  };

  // While waiting for faucet gas, poll the balance and continue registration by itself.
  useEffect(() => {
    if (registrationStage !== "gas" || !provider || !account) return;
    let stopped = false;
    const timer = setInterval(async () => {
      const balance = await provider.getBalance(account).catch(() => 0n);
      if (stopped || balance === 0n) return;
      stopped = true; clearInterval(timer);
      setData(current => ({ ...current, gas: balance }));
      registerMember({ provider, account });
    }, 5000);
    return () => { stopped = true; clearInterval(timer); };
  }, [registrationStage, provider, account]);

  const switchNetwork = async () => {
    if (!walletProvider) return connect();
    return connect(walletProvider);
  };

  useEffect(() => {
    const eth = walletProvider;
    if (!eth?.on) return;
    const refresh = async () => {
      try {
        const [accounts, chainId] = await Promise.all([eth.request({ method: "eth_accounts" }), eth.request({ method: "eth_chainId" })]);
        setRegistrationStage("idle"); setRegistrationError("");
        if (!accounts?.[0]) { setAccount(""); setProvider(null); return; }
        if (!isOnTestnet(chainId)) {
          setAccount(""); setProvider(null);
          setConnectError("Your wallet switched to a different network. Switch back to BSC Testnet to continue.");
          return;
        }
        setConnectError("");
        const nextProvider = new ethers.BrowserProvider(eth);
        setProvider(nextProvider); setAccount(accounts[0]);
        await load(nextProvider, accounts[0]);
      } catch {}
    };
    // Rebuild in place instead of reloading the page, so a network switch mid-connect never loses progress.
    eth.on("accountsChanged", refresh);
    eth.on("chainChanged", refresh);
    return () => {
      eth.removeListener?.("accountsChanged", refresh);
      eth.removeListener?.("chainChanged", refresh);
    };
  }, [walletProvider]);

  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash === "#/dashboard" ? "dashboard" : "home");
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const transact = async (kind, arg) => {
    if (!account) return connect();
    if (!isConfigured) return setNotice("Add VITE_VANTEX_ADDRESS and VITE_TOKEN_ADDRESS to enable transactions.");
    setBusy(true); setNotice("");
    try {
      const contract = await signerContract();
      let tx;
      if (kind === "mint") {
        const token = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, await provider.getSigner());
        tx = await token.mint(account, ethers.parseUnits("10000", TOKEN_DECIMALS));
      } else if (kind === "invest") {
        const value = ethers.parseUnits(amount || "0", TOKEN_DECIMALS);
        const signer = await provider.getSigner();
        const token = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, signer);
        const plan = allPlans.find(item => item.index === selectedPlan);
        const numericAmount = Number(amount);
        if (!Number.isFinite(numericAmount) || numericAmount < plan.min || numericAmount > plan.max) throw new Error(`Enter an amount from $${plan.min.toLocaleString()} to $${plan.max.toLocaleString()} for ${plan.name}.`);
        const balance = await token.balanceOf(account);
        if (balance < value) throw new Error(`Insufficient test mUSDT. Mint tokens first; this wallet has ${ethers.formatUnits(balance, TOKEN_DECIMALS)} mUSDT.`);
        const currentMember = await contract.members(account);
        let permitDetails;
        try {
          const [tokenName, nonce, network] = await Promise.all([token.name(), token.nonces(account), provider.getNetwork()]);
          permitDetails = { tokenName, nonce, network };
        } catch {
          let placement = { referrer, leg };
          if (!currentMember.registered) {
            placement = await selectRegistrationPlacement(contract);
            setNotice("Current testnet contracts require registration confirmation…");
            const registration = await registerCall(contract, placement, registrationMode);
            await registration.wait();
          }
          const allowance = await token.allowance(account, CONTRACT_ADDRESS);
          if (allowance < value) {
            setNotice("Current testnet contracts require token approval confirmation…");
            const approval = await token.approve(CONTRACT_ADDRESS, value);
            await approval.wait();
          }
          tx = await contract.invest(value, selectedPlan);
        }
        if (tx) {
          setNotice("Position transaction submitted. Waiting for confirmation…");
          await tx.wait();
          setNotice("Position created successfully.");
          await load();
          return;
        }
        const { tokenName, nonce, network } = permitDetails;
        const deadline = Math.floor(Date.now() / 1000) + 3600;
        const signature = await signer.signTypedData(
          { name: tokenName, version: "1", chainId: network.chainId, verifyingContract: TOKEN_ADDRESS },
          { Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" }
          ] },
          { owner: account, spender: CONTRACT_ADDRESS, value, nonce, deadline }
        );
        const { v, r, s } = ethers.Signature.from(signature);
        if (currentMember.registered) tx = await contract.investWithPermit(value, selectedPlan, deadline, v, r, s);
        else {
          const placement = await selectRegistrationPlacement(contract);
          setReferrer(placement.referrer);
          setLeg(placement.leg);
          tx = await supportsSponsor(contract)
            ? await contract.registerAndInvestWithSponsor(inviterRef.current.ref || ZERO, placement.referrer, placement.leg, 0, registrationMode, value, selectedPlan, { deadline, v, r, s })
            : await contract.registerAndInvestWithPermitAndMode(placement.referrer, placement.leg, 0, registrationMode, value, selectedPlan, deadline, v, r, s);
        }
      } else if (kind === "setRewardMode") {
        tx = await contract.setRewardMode(arg);
      }
      else tx = await contract[kind]();
      setNotice("Transaction submitted. Waiting for confirmation…");
      await tx.wait();
      setNotice({
        mint: "10,000 test mUSDT added to your wallet.",
        claimRoi: "Rewards claimed to your wallet.",
        claimSalary: "Salary claimed to your wallet.",
        setRewardMode: arg === 1 ? "Auto Compound is on. Rewards will be reinvested." : "Rewards will now be paid to your wallet."
      }[kind] || "Transaction confirmed.");
      await load();
    } catch (error) { setNotice(friendlyError(error)); }
    finally { setBusy(false); }
  };

  const selectPlan = (index) => {
    const plan = allPlans.find(item => item.index === index);
    setSelectedPlan(index);
    const numericAmount = Number(amount || 0);
    if (numericAmount < plan.min || numericAmount > plan.max) setAmount(String(plan.min));
  };

  const changeAmount = (value) => {
    setAmount(value);
    if (selectedPlan >= 4) return; // every compound package accepts the full $1-$2,500 range
    const numericAmount = Number(value);
    const matchingPlan = plans.find(plan => numericAmount >= plan.min && numericAmount <= plan.max);
    if (matchingPlan) setSelectedPlan(matchingPlan.index);
  };

  const projected = useMemo(() => {
    const plan = allPlans.find(item => item.index === selectedPlan);
    if (!plan) return 0;
    const principal = Number(amount || 0);
    return selectedPlan >= 4 ? principal * (1 + plan.rateValue * plan.earningDays / 100) : principal * 2;
  }, [amount, selectedPlan]);

  const openDashboard = () => { window.location.hash = "/dashboard"; setRoute("dashboard"); window.scrollTo(0, 0); };
  const openHome = () => { window.location.hash = ""; setRoute("home"); window.scrollTo(0, 0); };
  const hasOpenDirectLeg = data.directA === ZERO || data.directB === ZERO;
  const availableReferralLeg = data.directA === ZERO ? 0 : data.directB === ZERO ? 1 : 0;
  const referralLink = account && data.member?.registered
    ? `${window.location.origin}${window.location.pathname}?ref=${account}${availableReferralLeg === 1 ? "&leg=1" : ""}`
    : "";
  const copyReferralLink = async () => {
    if (!referralLink) return setNotice("Register this wallet before generating a referral link.");
    await navigator.clipboard.writeText(referralLink);
    setNotice(hasOpenDirectLeg
      ? `Referral link copied for Organization ${availableReferralLeg === 0 ? "A" : "B"}.`
      : "Referral link copied. New members will use the next open position in your organization.");
  };

  const startFirstPosition = () => {
    setRegistrationOpen(false);
    setRegistrationStage("idle");
    window.location.hash = "/dashboard"; setRoute("dashboard");
    setTimeout(() => document.getElementById("new-position")?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
  };

  const wizard = <RegistrationWizard
    open={registrationOpen} onClose={closeRegistration} account={account} connect={connect}
    isConfigured={isConfigured} registered={Boolean(data.member?.registered)}
    stage={registrationStage} error={registrationError} txHash={registrationTx}
    onRegister={(mode) => registerMember(undefined, mode)} onContinue={connectAndRegister}
    registrationMode={registrationMode} setRegistrationMode={setRegistrationMode}
    sponsor={referrer} leg={leg} linkReferrer={inviter.ref} preferredLeg={inviter.leg} onApplyInvite={applyInvite}
    onCheckReferrer={checkReferrer}
    joinFee={joinFee} onSwitchAccount={switchAccount}
    placementReady={placementReady} placementError={placementError} gasBalance={data.gas}
    usdtBalance={data.balance} onMintUsdt={() => mintTestUsdt()}
    referralLink={referralLink} copyReferralLink={copyReferralLink} onInvest={startFirstPosition}
    wallets={wallets} connectStage={connectStage} connectError={connectError}
    wrongNetwork={Boolean(walletProvider) && !account} onSwitchNetwork={switchNetwork}
  />;

  if (route === "dashboard") return <><Dashboard {...{
    account, connect, data, notice, busy, isConfigured, plans, selectedPlan,
    setSelectedPlan: selectPlan, amount, setAmount: changeAmount, projected, transact, referrer,
    setReferrer, leg, setLeg, registrationMode, setRegistrationMode,
    referralLink, copyReferralLink, linkReferrer: inviter.ref,
    compoundPlans, openRegistration, levels,
    refresh: () => load(), clearNotice: () => setNotice(""), onSwitchAccount: switchAccount, loadTeam, loadRoiIncome
  }} tokenDecimals={TOKEN_DECIMALS} onHome={openHome}/>{wizard}</>;

  const startInvesting = () => {
    window.location.hash = "/dashboard"; setRoute("dashboard");
    setTimeout(() => document.getElementById("new-position")?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
  };

  return <><Home {...{
    account, connect, data, plans, compoundPlans, levels, selectedPlan, selectPlan, amount, changeAmount, projected,
    isConfigured, notice, linkReferrer: inviter.ref, openRegistration, openDashboard, startInvesting, referralLink,
    onMintUsdt: mintFromHome
  }}/>{wizard}</>;
}

createRoot(document.getElementById("root")).render(<React.StrictMode><App/></React.StrictMode>);
