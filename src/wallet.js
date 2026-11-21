import { useEffect, useState } from "react";

export const BSC_TESTNET_CHAIN_ID = "0x61";
export const BSC_TESTNET = {
  chainId: BSC_TESTNET_CHAIN_ID,
  chainName: "BSC Testnet",
  nativeCurrency: { name: "Test BNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: ["https://data-seed-prebsc-1-s1.bnbchain.org:8545", "https://bsc-testnet-rpc.publicnode.com"],
  blockExplorerUrls: ["https://testnet.bscscan.com"]
};

const LAST_WALLET_KEY = "vantex-wallet";
export const rememberWallet = (id) => { try { localStorage.setItem(LAST_WALLET_KEY, id); } catch {} };
export const lastWallet = () => { try { return localStorage.getItem(LAST_WALLET_KEY) || ""; } catch { return ""; } };

export const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
export const isOnTestnet = (chainId) => typeof chainId === "string" && parseInt(chainId, 16) === parseInt(BSC_TESTNET_CHAIN_ID, 16);

const injectedName = (eth) => eth?.isTrust || eth?.isTrustWallet ? "Trust Wallet"
  : eth?.isTokenPocket ? "TokenPocket"
  : eth?.isBinance || eth?.isBinanceChain ? "Binance Wallet"
  : eth?.isCoinbaseWallet ? "Coinbase Wallet"
  : eth?.isOkxWallet || eth?.isOKExWallet ? "OKX Wallet"
  : eth?.isMetaMask ? "MetaMask"
  : "Browser wallet";

// Discovers every installed wallet (EIP-6963), falling back to window.ethereum for older wallets
// and in-app browsers such as MetaMask Mobile or Trust Wallet.
export function useWallets() {
  const [announced, setAnnounced] = useState([]);
  const [injected, setInjected] = useState(() => window.ethereum || null);
  useEffect(() => {
    const onAnnounce = (event) => {
      const { info, provider } = event.detail || {};
      if (!info?.uuid || !provider?.request) return;
      setAnnounced(list => list.some(wallet => wallet.id === (info.rdns || info.uuid)) ? list
        : [...list, { id: info.rdns || info.uuid, name: info.name, icon: info.icon, provider }]);
    };
    const onInjected = () => setInjected(window.ethereum || null);
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.addEventListener("ethereum#initialized", onInjected, { once: true });
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    // Some wallets inject late; look once more after the page settles.
    const timer = setTimeout(onInjected, 600);
    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      window.removeEventListener("ethereum#initialized", onInjected);
      clearTimeout(timer);
    };
  }, []);
  if (announced.length) return announced;
  return injected?.request ? [{ id: "injected", name: injectedName(injected), icon: "", provider: injected }] : [];
}

export const walletErrorCode = (error) =>
  error?.code ?? error?.error?.code ?? error?.data?.originalError?.code ?? error?.info?.error?.code;

export const connectErrorMessage = (error) => {
  const code = walletErrorCode(error);
  if (code === 4001 || code === "ACTION_REJECTED") return "The request was closed in your wallet. Click the button again when you're ready.";
  if (code === -32002) return "Your wallet already has a request waiting. Open the wallet (click its icon in the browser toolbar) and approve it.";
  if (code === 4100) return "Your wallet is locked. Unlock it, then try again.";
  return error?.message || "Couldn't connect to your wallet. Please try again.";
};

// Asks for account access first, then moves the wallet to BSC Testnet (adding the network if needed).
export async function requestAccount(eth, onStep = () => {}) {
  onStep("approve");
  const accounts = await eth.request({ method: "eth_requestAccounts" });
  if (!accounts?.[0]) throw new Error("No account was shared. Unlock your wallet and try again.");
  onStep("network");
  await ensureTestnet(eth);
  return accounts[0];
}

export async function ensureTestnet(eth) {
  if (isOnTestnet(await eth.request({ method: "eth_chainId" }))) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BSC_TESTNET_CHAIN_ID }] });
  } catch (error) {
    const code = walletErrorCode(error);
    const unknownChain = code === 4902 || code === -32603 || /unrecognized|not added|unknown chain|add it first/i.test(error?.message || "");
    if (!unknownChain) throw error;
    await eth.request({ method: "wallet_addEthereumChain", params: [BSC_TESTNET] });
  }
  if (!isOnTestnet(await eth.request({ method: "eth_chainId" }))) {
    const wrongNetwork = new Error("Your wallet is still on another network. Approve the switch to BSC Testnet to continue.");
    wrongNetwork.code = "WRONG_NETWORK";
    throw wrongNetwork;
  }
}

// Deep links that open this exact page (including the referral code) inside a mobile wallet's browser.
export const mobileWalletLinks = () => {
  const href = window.location.href;
  const withoutProtocol = href.replace(/^https?:\/\//, "");
  return [
    { name: "MetaMask", url: `https://metamask.app.link/dapp/${withoutProtocol}` },
    { name: "Trust Wallet", url: `https://link.trustwallet.com/open_url?coin_id=20000714&url=${encodeURIComponent(href)}` }
  ];
};
