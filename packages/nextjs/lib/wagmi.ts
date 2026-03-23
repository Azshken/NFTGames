import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { cookieStorage, createStorage } from "wagmi";
import { sepolia } from "viem/chains";

export const wagmiConfig = getDefaultConfig({
  appName: "SoulKey Store",
  projectId: process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID || "3a8170812b534d0ff9d794f19a901d64",
  chains: [sepolia],
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
});
