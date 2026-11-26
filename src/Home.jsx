import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import {
  ArrowRight, ArrowUpRight, CalendarDays, Check, ChevronDown, CircleAlert, Coins, Copy, Crown, ExternalLink, Fuel, Gift, LayoutDashboard, Link2, Loader2,
  Menu, MessageCircle, Network, QrCode, Send, Share2, ShieldCheck, Sparkles, TrendingUp, UserPlus, Users, Wallet, X
} from "lucide-react";
import Avatar from "./Avatar";
import ReferralQr from "./ReferralQr";
import "./home.css";

const ZERO = "0x0000000000000000000000000000000000000000";

const money = (value, digits = 2) => Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const short = (address) => address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
const salaryTiers = [[1000, 25], [2000, 50], [5000, 125], [10000, 250], [20000, 500]];

const faqs = [
  ["What do I need to join?", "A free crypto wallet such as MetaMask or Trust Wallet, plus a little test BNB (tBNB) for network fees. If you don't have tBNB yet, the join window shows you where to get it free and continues automatically once it arrives."],
  ["Do I need an email or password?", "No. Your wallet is your account. You approve each action in your wallet, and nobody else can move your funds."],
  ["How do invitations work?", "When you open someone's referral link, you join their team automatically. If their two direct positions (Organization A and B) are full, you're placed in the next open position in their team."],
  ["What is the difference between ROI and Compound?", "ROI packages pay up to 2×. Compound mode lets you choose Starter, Growth, or Elite: profit is withdrawable anytime, while principal stays locked until the selected earning term ends."],
  ["Are returns guaranteed?", "No. The figures on this page are calculations from the contract terms, not promises. Rewards depend on the contract holding enough funds, and smart contracts carry risk. Only use money you can afford to lose."],
  ["Is this live with real money?", "The app currently runs on BSC Testnet with test tokens, so you can try every feature without spending real funds."]
];

export default function Home({
  account, connect, data, plans, compoundPlans = [], levels, selectedPlan, selectPlan, amount, changeAmount, projected,
  isConfigured, notice, linkReferrer, openRegistration, openDashboard, startInvesting, referralLink, onMintUsdt
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const [copied, setCopied] = useState("");
  const [showQr, setShowQr] = useState(false);
  const copy = async (text, key) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(""), 1800); } catch {}
  };
  const shareText = "Join my team on Vantex Capital:";
  const [mint, setMint] = useState({ status: "idle", error: "" });
  const mintUsdt = async () => {
    setMint({ status: "minting", error: "" });
    const problem = await onMintUsdt();
    setMint(problem ? { status: "idle", error: problem } : { status: "done", error: "" });
    if (!problem) setTimeout(() => setMint(current => current.status === "done" ? { status: "idle", error: "" } : current), 4000);
  };
  const usdt = Number(data.balance || 0);
  const tbnb = data.gas === null || data.gas === undefined ? null : Number(ethers.formatEther(data.gas));

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const registered = Boolean(data.member?.registered);
  const compoundSelected = selectedPlan >= 4;
  const plan = (compoundSelected ? compoundPlans : plans).find(item => item.index === selectedPlan) || plans[0];
  const numericAmount = Number(amount) || 0;
  // ROI packages: each daily payout is half profit, half returned capital. Compound plans pay profit only.
  const dailyProfit = numericAmount * plan.rateValue / (compoundSelected ? 100 : 200);
  const profit = Math.max(0, projected - numericAmount);
  const primaryAction = registered ? startInvesting : openRegistration;
  const primaryLabel = registered ? "Create a position" : "Join in one minute";
  const go = (id) => { setMenuOpen(false); document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }); };

  return <div className="hp">
    <header className={`hp-nav ${scrolled ? "scrolled" : ""}`}>
      <div className="hp-wrap hp-nav-inner">
        <a className="hp-brand" href="#top" onClick={event => { event.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
          <span className="hp-mark">V</span><span>VANTEX<small>CAPITAL</small></span>
        </a>
        <nav className={`hp-links ${menuOpen ? "open" : ""}`}>
          <button onClick={() => go("how")}>How it works</button>
          <button onClick={() => go("packages")}>Plans</button>
          <button onClick={() => go("network")}>Rewards</button>
          <button onClick={() => go("faq")}>Help</button>
          <button className="hp-links-cta" onClick={() => { setMenuOpen(false); registered ? openDashboard() : openRegistration(); }}>{registered ? "Open dashboard" : "Join now"}</button>
        </nav>
        <div className="hp-nav-actions">
          {account
            ? <button className="hp-wallet" onClick={openDashboard}><i/>{short(account)}<LayoutDashboard size={15}/></button>
            : <button className="hp-wallet" onClick={() => connect()}><Wallet size={15}/>Connect</button>}
          <button className="hp-btn gold hp-nav-join" onClick={registered ? openDashboard : openRegistration}>{registered ? "Dashboard" : "Join now"}</button>
          <button className="hp-menu" aria-label="Menu" onClick={() => setMenuOpen(value => !value)}>{menuOpen ? <X size={20}/> : <Menu size={20}/>}</button>
        </div>
      </div>
    </header>

    <main id="top">
      {linkReferrer && !registered && <div className="hp-wrap">
        <div className="hp-invite">
          <Gift size={18}/><span><b>You've been invited</b> by {short(linkReferrer)}. Join now to be placed in their team.</span>
          <button className="hp-btn gold small" onClick={openRegistration}>Accept invitation <ArrowRight size={15}/></button>
        </div>
      </div>}
      {notice && <div className="hp-wrap"><div className="hp-notice">{notice}</div></div>}

      {account && registered && referralLink && <div className="hp-wrap">
        <section className="hp-ref" aria-label="Your referral link">
          <div className="hp-ref-head">
            <Avatar address={account} size={42}/>
            <div><span className="hp-eyebrow"><Gift size={13}/> Your referral link is ready</span><h2>Invite people to your team</h2></div>
            <div className="hp-ref-slots">
              {[["A", data.directA], ["B", data.directB]].map(([side, occupant]) => <span key={side} className={occupant === ZERO ? "open" : ""}>
                {occupant === ZERO ? <UserPlus size={13}/> : <Check size={13}/>} Organization {side}: {occupant === ZERO ? "Open" : "Filled"}
              </span>)}
            </div>
          </div>
          <div className="hp-ref-row">
            <div className="hp-ref-field"><Link2 size={16}/><input readOnly value={referralLink} onFocus={event => event.target.select()} aria-label="Your referral link"/></div>
            <button className="hp-btn gold" onClick={() => copy(referralLink, "link")}>{copied === "link" ? <><Check size={16}/> Copied</> : <><Copy size={16}/> Copy link</>}</button>
          </div>
          <div className="hp-ref-actions">
            <a href={`https://wa.me/?text=${encodeURIComponent(`${shareText} ${referralLink}`)}`} target="_blank" rel="noreferrer"><MessageCircle size={15}/> WhatsApp</a>
            <a href={`https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer"><Send size={15}/> Telegram</a>
            {typeof navigator !== "undefined" && navigator.share && <button onClick={() => navigator.share({ title: "Vantex Capital", text: shareText, url: referralLink }).catch(() => {})}><Share2 size={15}/> More</button>}
            <button onClick={() => setShowQr(true)}><QrCode size={15}/> QR code</button>
            <button onClick={() => copy(account, "addr")}>{copied === "addr" ? <><Check size={15}/> Address copied</> : <><Wallet size={15}/> Copy wallet address</>}</button>
            <button className="hp-ref-dash" onClick={openDashboard}>Team dashboard <ArrowUpRight size={15}/></button>
          </div>
          <p className="hp-ref-note">New members can open your link, scan your QR code, or enter your wallet address in the join window.</p>
        </section>
        {showQr && <ReferralQr link={referralLink} address={account} onClose={() => setShowQr(false)}/>}
      </div>}

      {account && data.member && !registered && !linkReferrer && <div className="hp-wrap">
        <div className="hp-invite hp-unlock">
          <Link2 size={18}/><span><b>Wallet connected.</b> Join to unlock your personal referral link.</span>
          <button className="hp-btn gold small" onClick={openRegistration}>Join now <ArrowRight size={15}/></button>
        </div>
      </div>}

      {isConfigured && <div className="hp-wrap">
        <section className="hp-faucet" aria-label="Test tokens">
          <div className="hp-faucet-icon"><Coins size={22}/></div>
          <div className="hp-faucet-copy">
            <span className="hp-eyebrow">BSC Testnet · free test tokens</span>
            <h2>Get mock USDT to try Vantex</h2>
            <p>Mock USDT is used to create positions. Registering only needs a little <b>tBNB</b> for gas.</p>
          </div>
          <div className="hp-faucet-side">
            {account && <div className="hp-faucet-balances">
              <span><Coins size={14}/> {usdt.toLocaleString("en-US", { maximumFractionDigits: 2 })} mUSDT</span>
              <span className={tbnb === 0 ? "low" : ""}><Fuel size={14}/> {tbnb === null ? "…" : tbnb.toLocaleString("en-US", { maximumFractionDigits: 4 })} tBNB</span>
            </div>}
            <div className="hp-faucet-actions">
              <button className="hp-btn gold" disabled={mint.status === "minting"} onClick={mintUsdt}>
                {mint.status === "minting" ? <><Loader2 size={16} className="hp-spin"/> Minting… confirm in wallet</>
                  : mint.status === "done" ? <><Check size={16}/> 10,000 mUSDT added</>
                  : <><Coins size={16}/> {account ? "Mint 10,000 mock USDT" : "Connect & mint 10,000 mock USDT"}</>}
              </button>
              <a className="hp-btn ghost" href="https://www.bnbchain.org/en/testnet-faucet" target="_blank" rel="noreferrer"><Fuel size={16}/> Free tBNB for gas <ExternalLink size={14}/></a>
            </div>
            {mint.error && <p className="hp-faucet-error"><CircleAlert size={14}/> {mint.error}</p>}
            {tbnb === 0 && !mint.error && <p className="hp-faucet-error warn"><Fuel size={14}/> No tBNB yet. Get some free from the faucet to pay gas for minting and registering.</p>}
          </div>
        </section>
      </div>}

      <section className="hp-hero hp-wrap">
        <div className="hp-hero-copy">
          <span className="hp-eyebrow"><Sparkles size={13}/> BSC Testnet · on-chain rules</span>
          <h1>Invest simply.<br/><em>Track everything.</em></h1>
          <p>Choose an amount, review the estimate, and create a position with your wallet. Your investments, rewards, and team stay in one dashboard.</p>
          <div className="hp-hero-actions">
            <button className="hp-btn gold large" onClick={primaryAction}>{primaryLabel} <ArrowUpRight size={18}/></button>
            <button className="hp-btn ghost large" onClick={() => go("packages")}>See packages</button>
          </div>
          <ul className="hp-checks"><li><Check size={15}/>No email or password</li><li><Check size={15}/>Uses free test tokens</li></ul>
        </div>

        <div className="hp-calc" aria-label="Package calculator">
          <div className="hp-calc-head"><span>Estimate your plan</span><b className={`hp-tag ${plan.color}`}>{plan.name}</b></div>
          <label htmlFor="hp-amount">Amount</label>
          <div className="hp-calc-amount"><span>$</span><input id="hp-amount" type="number" min="1" max="2500" inputMode="decimal" value={amount} onChange={event => changeAmount(event.target.value)}/><b>USDT</b></div>
          <input className="hp-range" type="range" min="1" max="2500" step="1" value={Math.min(2500, Math.max(1, numericAmount))} onChange={event => changeAmount(event.target.value)} aria-label="Amount slider"/>
          <div className="hp-calc-quick">{[100, 500, 1000, 2500].map(value => <button key={value} className={numericAmount === value ? "active" : ""} onClick={() => changeAmount(String(value))}>${value.toLocaleString()}</button>)}</div>
          <div className="hp-calc-rows">
            <div><span>Profit per day <small>{plan.rate} · Mon–Fri</small></span><b className="up">${money(dailyProfit)}</b></div>
            {!compoundSelected && <div><span>Capital returned per day <small>{plan.rate}</small></span><b>${money(dailyProfit)}</b></div>}
            <div><span>Earning days</span><b>≈{plan.earningDays}</b></div>
            <div><span>Profit over the term</span><b className="up">+${money(profit)}</b></div>
            <div className="total"><span>Total paid back <small>incl. your capital</small></span><b>${money(projected)}</b></div>
          </div>
          <button className="hp-btn gold full" onClick={primaryAction}>{registered ? `Start ${plan.name}` : "Join & start"} <ArrowRight size={16}/></button>
          <p className="hp-calc-note">An estimate from the contract terms, not a guarantee.</p>
        </div>
      </section>

      <section id="how" className="hp-section hp-wrap">
        <div className="hp-head center"><span className="hp-eyebrow">How it works</span><h2>Three simple steps</h2></div>
        <div className="hp-steps">
          <article><div className="hp-step-icon"><Wallet/></div><span>Step 1</span><h3>Connect your wallet</h3><p>Use MetaMask, Trust Wallet or any browser wallet. We switch you to the right network automatically.</p></article>
          <article><div className="hp-step-icon"><UserPlus/></div><span>Step 2</span><h3>Join with one tap</h3><p>Confirm once in your wallet. Your sponsor and team position are set for you automatically.</p></article>
          <article><div className="hp-step-icon"><TrendingUp/></div><span>Step 3</span><h3>Invest &amp; invite</h3><p>Open a package, earn Monday–Friday rewards and share your link to grow Organization A and B.</p></article>
        </div>
      </section>

      <section id="packages" className="hp-section hp-wrap">
        <div className="hp-head"><div><span className="hp-eyebrow">ROI plans</span><h2>Choose by investment amount</h2></div><p>Your amount selects the matching plan automatically. Each day pays profit plus an equal amount of returned capital, and every position stops at a 2× total payout.</p></div>
        <div className="hp-plans">{plans.map(item => <article key={item.name} className={`hp-plan ${item.color} ${selectedPlan === item.index ? "active" : ""}`} onClick={() => selectPlan(item.index)}>
          <div className="hp-plan-top"><span>{item.name}</span></div>
          <h3>{item.rate}<small>/ day profit</small></h3>
          <p className="hp-plan-range">{item.label}</p>
          <ul>
            <li><ShieldCheck size={14}/>+ {item.rate} capital released daily</li>
            <li><Coins size={14}/>{item.totalRate} total paid per earning day</li>
            <li><CalendarDays size={14}/>{item.days}</li>
          </ul>
          <button className="hp-btn outline full" onClick={event => { event.stopPropagation(); selectPlan(item.index); primaryAction(); }}>{registered ? "Start this package" : "Join & choose"} <ArrowRight size={15}/></button>
        </article>)}</div>
      </section>

      <section id="compounding" className="hp-section hp-wrap">
        <div className="hp-head"><div><span className="hp-eyebrow">Compound plans</span><h2>Choose a fixed term</h2></div><p>Profit accrues Monday–Friday and can be withdrawn while the original amount remains locked until the term ends.</p></div>
        <div className="hp-plans three">{compoundPlans.map(item => <article key={item.index} className={`hp-plan ${item.color}`} onClick={() => selectPlan(item.index)}>
          <div className="hp-plan-top"><span>{item.name}</span></div>
          <h3>{item.rate}<small>/ earning day</small></h3>
          <p className="hp-plan-range">{item.earningDays} earning days</p>
          <ul>
            <li><CalendarDays size={14}/>{item.days}</li>
            <li><Coins size={14}/>Profit withdrawable anytime</li>
            <li><ShieldCheck size={14}/>Principal unlocked at maturity</li>
          </ul>
          <button className="hp-btn outline full" onClick={event => { event.stopPropagation(); selectPlan(item.index); primaryAction(); }}>Choose {item.name} <ArrowRight size={15}/></button>
        </article>)}</div>
      </section>

      <section id="network" className="hp-section hp-network">
        <div className="hp-wrap hp-network-grid">
          <div>
            <span className="hp-eyebrow">Network rewards</span>
            <h2>Direct rewards.<br/>Full-team salary.</h2>
            <p><b>ROI-on-ROI</b> pays 10% of the profit claimed or compounded by your direct referrals only. Deposits from your full A/B organization count as team business toward <b>salary</b> milestones.</p>
            <div className="hp-split">
              <div className="a"><span>Organization A</span><b>50%</b></div>
              <i>+</i>
              <div className="b"><span>Organization B</span><b>50%</b></div>
            </div>
            <small className="hp-muted">Qualification uses equal business volume from both organizations. The number of contributors can differ: one person can provide one side's volume while several people collectively provide the other side.</small>
          </div>
          <div className="hp-levels" aria-label="Direct referral reward percentage">
            <div><span>Direct referral</span><i><em style={{ width: "100%" }}/></i><b>10%</b></div>
          </div>
        </div>
      </section>

      <section className="hp-section hp-wrap hp-salary-section">
        <div className="hp-head"><div><span className="hp-eyebrow">Business salary</span><h2>Milestones that pay</h2></div><p>Reach a balanced-business milestone to unlock a salary paid every 15 days for six cycles.</p></div>
        <div className="hp-salary">{salaryTiers.map(([business, salary], index) => <article key={business}>
          <span><Crown size={14}/> Rank {index + 1}</span>
          <strong>${salary}</strong><small>every 15 days × 6</small>
          <p>${business.toLocaleString()} balanced business</p>
        </article>)}</div>
      </section>

      <section id="faq" className="hp-section hp-wrap hp-faq-wrap">
        <div className="hp-head center"><span className="hp-eyebrow">FAQ</span><h2>Questions, answered</h2></div>
        <div className="hp-faq">{faqs.map(([question, answer], index) => <div key={question} className={openFaq === index ? "open" : ""}>
          <button aria-expanded={openFaq === index} onClick={() => setOpenFaq(openFaq === index ? -1 : index)}>{question}<ChevronDown size={18}/></button>
          {openFaq === index && <p>{answer}</p>}
        </div>)}</div>
      </section>

      <section className="hp-wrap">
        <div className="hp-final">
          <div><Users size={22}/><h2>{registered ? "Your dashboard is ready." : "Ready to join?"}</h2><p>{registered ? "Track positions, claim rewards and share your referral link." : "Connect your wallet and join in about a minute. No email or password needed."}</p></div>
          <button className="hp-btn gold large" onClick={registered ? openDashboard : openRegistration}>{registered ? "Open dashboard" : "Join now"} <ArrowUpRight size={18}/></button>
        </div>
      </section>
    </main>

    <footer className="hp-footer">
      <div className="hp-wrap">
        <div className="hp-footer-top">
          <div className="hp-brand"><span className="hp-mark">V</span><span>VANTEX<small>CAPITAL</small></span></div>
          <nav><button onClick={() => go("how")}>How it works</button><button onClick={() => go("packages")}>Packages</button><button onClick={() => go("network")}>Network</button><button onClick={openDashboard}>Dashboard</button></nav>
        </div>
        <p className="hp-risk"><Network size={14}/> {isConfigured ? "Running on BSC Testnet with test tokens." : "Preview mode: contracts are not configured."} Figures shown are calculations from the smart contract terms, not guarantees. Rewards depend on available contract funds, and smart contracts carry risk. Only participate with funds you can afford to lose.</p>
        <span className="hp-copy">© 2026 Vantex Capital</span>
      </div>
    </footer>
  </div>;
}
