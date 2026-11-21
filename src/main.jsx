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
const BSC_RPC = "https://data-seed-prebsc-1-s1.bnbchain.org:8545";
const AUTO_OPEN_REGISTRATION = Boolean(QUERY_REFERRER) || REFERRAL_PARAMS.get("action") === "register";

const VANTEX_ABI = [
  "error AlreadyRegistered()",
  "error InvalidAmount()",
  "error InvalidReferrer()",
  "error LegOccupied()",
  "error Paused()",
  "error TooManyPositions()",
  "function members(address) view returns (address referrer,uint128 personalBusiness,uint128 legABusiness,uint128 legBBusiness,uint40 salaryStartedAt,uint8 salaryRank,uint8 salaryClaims,uint8 split,bool registered)",
  "function owner() view returns (address)",
  "function directLeg(address,uint8) view returns (address)",
  "function referralEarnings(address) view returns (uint256)",
  "function rewardMode(address) view returns (uint8)",
  "function pendingRoi(address) view returns (uint256)",
  "function balancedBusiness(address) view returns (uint256)",
  "function qualifiedLevel(address) view returns (uint8)",
  "function positionsOf(address) view returns (tuple(uint128 principal,uint128 claimed,uint40 startedAt,uint40 endsAt,uint16 dailyRateBps,uint8 plan)[])",
  "function register(address referrer,uint8 leg,uint8 split)",
  "function registerWithMode(address referrer,uint8 leg,uint8 split,uint8 mode)",
  "function invest(uint256 amount,uint8 plan)",
  "function investWithPermit(uint256 amount,uint8 plan,uint256 deadline,uint8 v,bytes32 r,bytes32 s)",
  "function registerAndInvestWithPermit(address referrer,uint8 leg,uint8 split,uint256 amount,uint8 plan,uint256 deadline,uint8 v,bytes32 r,bytes32 s)",
  "function registerAndInvestWithPermitAndMode(address referrer,uint8 leg,uint8 split,uint8 mode,uint256 amount,uint8 plan,uint256 deadline,uint8 v,bytes32 r,bytes32 s)",
  "function compoundRoi(uint8 plan)",
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

const levels = [10, 5, 4, 3, 3, 3, 2, 2, 1, 1, 2, 2, 3, 4, 5];

const walletErrorCodeIsNetwork = (error) => error?.code === "WRONG_NETWORK";

const friendlyError = (error) => {
  if (error?.code === "ACTION_REJECTED") return "Transaction cancelled in your wallet.";
  const revertName = error?.revert?.name;
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
  const [split, setSplit] = useState(0);
  const [registrationMode, setRegistrationMode] = useState(0);
  const [data, setData] = useState({ balance: "0", gas: null, pending: "0", business: "0", referralEarnings: "0", rewardMode: 0, level: 0, member: null, positions: [], directA: ZERO, directB: ZERO });
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
      const alternateOccupant = inviteLeg === 0 ? legB : legA;
      if (preferredOccupant === ZERO) return { referrer: inviteRef, leg: inviteLeg };
      if (alternateOccupant === ZERO) return { referrer: inviteRef, leg: inviteLeg === 0 ? 1 : 0 };
      return findOpenPlacement(reader, inviteRef);
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
      const [member, pending, business, referralTotal, memberRewardMode, level, positions, balance, directA, directB, gas] = await Promise.all([
        reader.members(activeAccount), reader.pendingRoi(activeAccount), reader.balancedBusiness(activeAccount),
        referralTotalPromise, rewardModePromise, reader.qualifiedLevel(activeAccount), reader.positionsOf(activeAccount),
        token.balanceOf(activeAccount), reader.directLeg(activeAccount, 0), reader.directLeg(activeAccount, 1),
        activeProvider.getBalance(activeAccount).catch(() => null)
      ]);
      if (member.registered) storage.clear();
      setData({ member, gas, pending: ethers.formatUnits(pending, TOKEN_DECIMALS), business: ethers.formatUnits(business, TOKEN_DECIMALS), referralEarnings: ethers.formatUnits(referralTotal, TOKEN_DECIMALS), rewardMode: Number(memberRewardMode), level: Number(level), positions, balance: ethers.formatUnits(balance, TOKEN_DECIMALS), directA, directB });
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
        if (cancelled || !accounts?.[0]) return;
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

  const registerMember = async (session) => {
    const activeProvider = session?.provider || provider;
    const activeAccount = session?.account || account;
    if (!activeAccount) return connectAndRegister();
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
        const args = [placement.referrer, placement.leg, split, registrationMode];
        try {
          await contract.registerWithMode.estimateGas(...args);
          setRegistrationStage("wallet");
          const tx = await contract.registerWithMode(...args);
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

  // Accepts a full referral link or a plain wallet address typed/pasted by the visitor.
  const applyInvite = async (input) => {
    const text = (input || "").trim();
    if (!text) { setInviter({ ref: "", leg: 0 }); storage.clear(); setPlacementError(""); await refreshPlacement(); return ""; }
    let ref = text; let nextLeg = 0;
    try {
      const url = new URL(text);
      ref = url.searchParams.get("ref") || ""; nextLeg = url.searchParams.get("leg") === "1" ? 1 : 0;
    } catch {}
    if (!ethers.isAddress(ref)) return "That doesn't look like an invite link or wallet address. Copy the full link your sponsor sent you.";
    if (account && ref.toLowerCase() === account.toLowerCase()) return "You can't invite yourself. Use your sponsor's link.";
    if (isConfigured) {
      const reader = new ethers.Contract(CONTRACT_ADDRESS, VANTEX_ABI, provider || ethers.getDefaultProvider(BSC_RPC));
      const sponsor = await reader.members(ref).catch(() => null);
      if (sponsor && !sponsor.registered) return "This address isn't an active member yet. Double-check the link with your sponsor.";
    }
    const next = { ref: ethers.getAddress(ref), leg: nextLeg };
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
          contract.registerWithMode.estimateGas(referrer, leg, split, registrationMode),
          provider.getFeeData()
        ]);
        const price = fees.gasPrice || fees.maxFeePerGas || 0n;
        if (!cancelled) setJoinFee(gas * price);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [registrationOpen, provider, account, placementReady, placementError, referrer, leg, split, registrationMode, data.member]);

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

  // One tap: connect, switch network and register without stopping in between.
  const connectAndRegister = async (chosen) => {
    const session = account && provider ? { provider, account } : await connect(chosen);
    if (!session || session.member?.registered) return;
    await registerMember(session);
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
        const plan = plans[selectedPlan];
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
            const registration = await contract.registerWithMode(placement.referrer, placement.leg, split, registrationMode);
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
          tx = await contract.registerAndInvestWithPermitAndMode(placement.referrer, placement.leg, split, registrationMode, value, selectedPlan, deadline, v, r, s);
        }
      } else if (kind === "compoundRoi") {
        const pendingAmount = Number(data.pending);
        const compoundPlan = plans.find(plan => pendingAmount >= plan.min && pendingAmount <= plan.max);
        if (!compoundPlan) {
          throw new Error(pendingAmount < 1
            ? "At least $1 of claimable ROI is required to compound."
            : "Claimable ROI above $2,500 cannot be compounded into a single position. Claim it to your wallet instead.");
        }
        tx = await contract.compoundRoi(compoundPlan.index);
      } else if (kind === "setRewardMode") {
        tx = await contract.setRewardMode(arg);
      }
      else tx = await contract[kind]();
      setNotice("Transaction submitted. Waiting for confirmation…");
      await tx.wait();
      setNotice({
        mint: "10,000 test mUSDT added to your wallet.",
        claimRoi: "Rewards claimed to your wallet.",
        compoundRoi: "Rewards compounded into a new position.",
        claimSalary: "Salary claimed to your wallet.",
        setRewardMode: arg === 1 ? "Auto Compound is on. Rewards will be reinvested." : "Rewards will now be paid to your wallet."
      }[kind] || "Transaction confirmed.");
      await load();
    } catch (error) { setNotice(friendlyError(error)); }
    finally { setBusy(false); }
  };

  const selectPlan = (index) => {
    const plan = plans[index];
    setSelectedPlan(index);
    const numericAmount = Number(amount || 0);
    if (numericAmount < plan.min || numericAmount > plan.max) setAmount(String(plan.min));
  };

  const changeAmount = (value) => {
    setAmount(value);
    const numericAmount = Number(value);
    const matchingPlan = plans.find(plan => numericAmount >= plan.min && numericAmount <= plan.max);
    if (matchingPlan) setSelectedPlan(matchingPlan.index);
  };

  const projected = useMemo(() => {
    return Number(amount || 0) * 2;
  }, [amount]);

  const compoundPlan = plans.find(plan => Number(data.pending) >= plan.min && Number(data.pending) <= plan.max) || null;

  const openDashboard = () => { window.location.hash = "/dashboard"; setRoute("dashboard"); window.scrollTo(0, 0); };
  const openHome = () => { window.location.hash = ""; setRoute("home"); window.scrollTo(0, 0); };
  const hasOpenDirectLeg = data.directA === ZERO || data.directB === ZERO;
  const availableReferralLeg = data.directA === ZERO ? 0 : data.directB === ZERO ? 1 : 0;
  const referralLink = account && data.member?.registered
    ? `${window.location.origin}${window.location.pathname}?ref=${account}&leg=${availableReferralLeg}&action=register#/dashboard`
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
    onRegister={() => registerMember()} onContinue={connectAndRegister}
    registrationMode={registrationMode} setRegistrationMode={setRegistrationMode}
    sponsor={referrer} leg={leg} linkReferrer={inviter.ref} onApplyInvite={applyInvite}
    joinFee={joinFee} onSwitchAccount={switchAccount}
    placementReady={placementReady} placementError={placementError} gasBalance={data.gas}
    referralLink={referralLink} copyReferralLink={copyReferralLink} onInvest={startFirstPosition}
    wallets={wallets} connectStage={connectStage} connectError={connectError}
    wrongNetwork={Boolean(walletProvider) && !account} onSwitchNetwork={switchNetwork}
  />;

  if (route === "dashboard") return <><Dashboard {...{
    account, connect, data, notice, busy, isConfigured, plans, selectedPlan,
    setSelectedPlan: selectPlan, amount, setAmount: changeAmount, projected, transact, referrer,
    setReferrer, leg, setLeg, split, setSplit, registrationMode, setRegistrationMode,
    referralLink, copyReferralLink, linkReferrer: inviter.ref,
    compoundPlan, openRegistration, levels,
    refresh: () => load(), clearNotice: () => setNotice(""), onSwitchAccount: switchAccount
  }} tokenDecimals={TOKEN_DECIMALS} onHome={openHome}/>{wizard}</>;

  const startInvesting = () => {
    window.location.hash = "/dashboard"; setRoute("dashboard");
    setTimeout(() => document.getElementById("new-position")?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
  };

  return <><Home {...{
    account, connect, data, plans, levels, selectedPlan, selectPlan, amount, changeAmount, projected,
    isConfigured, notice, linkReferrer: inviter.ref, openRegistration, openDashboard, startInvesting
  }}/>{wizard}</>;
}

createRoot(document.getElementById("root")).render(<React.StrictMode><App/></React.StrictMode>);
