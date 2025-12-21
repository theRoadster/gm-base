"use client";

import { useState, useEffect } from "react";
import { useAccount, useReadContract, usePublicClient } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { DAILY_GM_ADDRESS, DAILY_GM_ABI } from "@/lib/contract";
import GMModal from "@/components/GMModal";
import CountdownTimer from "@/components/CountdownTimer";
import Stats from "@/components/Stats";
import WalletConnect from "@/components/WalletConnect";
import NetworkIndicator from "@/components/NetworkIndicator";

// Determine target chain based on environment
const targetChain = process.env.NEXT_PUBLIC_CHAIN_ID === '8453' ? base : baseSepolia;

export default function Home() {
  const { address, isConnected } = useAccount();
  const [showModal, setShowModal] = useState(false);
  const [showCountdown, setShowCountdown] = useState(false);
  const [gmsReceived, setGmsReceived] = useState(0);
  const [mounted, setMounted] = useState(false);
  const publicClient = usePublicClient({ chainId: targetChain.id });

  useEffect(() => {
    setMounted(true);
  }, []);

  // Helper function to fetch GMs via Alchemy API route
  async function fetchGMsViaAPI(address: string): Promise<number> {
    const response = await fetch(`/api/fetch-gms?address=${address}`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'API request failed');
    }

    const data = await response.json();
    return data.count;
  }

  // Fetch GMs received - Alchemy first, then fallback to chunking
  useEffect(() => {
    async function fetchGMsReceived() {
      if (!address) return;

      // Try API route first (Alchemy via server)
      try {
        console.log('🚀 Fetching GMs via Alchemy API route...');
        const startTime = Date.now();
        const count = await fetchGMsViaAPI(address);
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        setGmsReceived(count);
        console.log(`✅ Fetched ${count} GMs via Alchemy in ${duration} seconds`);
        return; // Success, exit early - NO CACHING (always fresh)
      } catch (error) {
        console.warn('⚠️ API route failed, falling back to chunking:', error);
        // Fall through to chunking approach
      }

      // Fallback: Chunking with caching (only used if API fails)
      if (!publicClient) return;

      try {
        // Get the current block number
        const currentBlock = await publicClient.getBlockNumber();

        // Contract deployment block on Base Sepolia
        const contractDeploymentBlock = 18000000n;

        // Check cache in localStorage
        const cacheKey = `gms-received-${address.toLowerCase()}`;
        const cached = localStorage.getItem(cacheKey);
        const cachedData = cached ? JSON.parse(cached) : null;

        let fromBlock = contractDeploymentBlock;
        let currentCount = 0;

        // If we have cached data, start from the last queried block
        if (cachedData && cachedData.lastBlock) {
          fromBlock = BigInt(cachedData.lastBlock) + 1n;
          currentCount = cachedData.count || 0;
          console.log(`Using cache: ${currentCount} GMs, resuming from block ${fromBlock}`);
        }

        // Only query if there are new blocks to check
        if (fromBlock <= currentBlock) {
          const maxBlockRange = 100000n;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let newLogs: any[] = [];

          // Query in chunks from last checked block to current
          while (fromBlock <= currentBlock) {
            const toBlock = fromBlock + maxBlockRange > currentBlock
              ? currentBlock
              : fromBlock + maxBlockRange;

            console.log(`Querying blocks ${fromBlock} to ${toBlock}...`);

            const logs = await publicClient.getLogs({
              address: DAILY_GM_ADDRESS,
              event: {
                type: 'event',
                name: 'GMSent',
                inputs: [
                  { type: 'address', indexed: true, name: 'sender' },
                  { type: 'address', indexed: true, name: 'recipient' },
                  { type: 'uint256', indexed: false, name: 'timestamp' }
                ]
              },
              args: {
                recipient: address,
              },
              fromBlock,
              toBlock
            });

            newLogs = [...newLogs, ...logs];
            fromBlock = toBlock + 1n;

            // Add a small delay between requests to avoid rate limiting
            if (fromBlock <= currentBlock) {
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }

          const totalCount = currentCount + newLogs.length;
          setGmsReceived(totalCount);

          // Update cache
          localStorage.setItem(cacheKey, JSON.stringify({
            count: totalCount,
            lastBlock: currentBlock.toString(),
            timestamp: Date.now()
          }));

          console.log(`Fetched ${newLogs.length} new GMs, total: ${totalCount}`);
        } else {
          // No new blocks, use cached count
          setGmsReceived(currentCount);
          console.log(`No new blocks, using cached count: ${currentCount}`);
        }
      } catch (error) {
        console.error("Error fetching GMs received:", error);
      }
    }

    fetchGMsReceived();
  }, [address, publicClient]);

  // Read user's streak (Your GMs)
  const { data: userStreak, isLoading: isLoadingStreak, error: streakError } = useReadContract({
    address: DAILY_GM_ADDRESS,
    abi: DAILY_GM_ABI,
    functionName: "streak",
    args: address ? [address] : undefined,
  });

  // Read last GM timestamp
  const { data: lastGMTimestamp } = useReadContract({
    address: DAILY_GM_ADDRESS,
    abi: DAILY_GM_ABI,
    functionName: "lastGM",
    args: address ? [address] : undefined,
  });

  // Log contract read errors for debugging
  if (streakError) {
    console.error("Error reading streak from contract:", streakError);
  }

  // Check if user can GM today
  const canGMToday = () => {
    if (!lastGMTimestamp) return true;
    const lastGMDate = new Date(Number(lastGMTimestamp) * 1000);
    const now = new Date();
    const lastGMDayUTC = Math.floor(lastGMDate.getTime() / 86400000);
    const currentDayUTC = Math.floor(now.getTime() / 86400000);
    return currentDayUTC > lastGMDayUTC;
  };

  const handleTapToGM = () => {
    if (!isConnected) {
      // Prompt user to connect wallet
      alert("Please connect your wallet to GM!");
      return;
    }

    if (canGMToday()) {
      setShowModal(true);
    } else {
      setShowCountdown(true);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-900 to-indigo-900 flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Wallet Connect Button */}
      <WalletConnect />

      {/* Network Indicator */}
      <NetworkIndicator />

      {/* Background gradient circles */}
      <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-cyan-600/30 rounded-full blur-3xl" />
      <div className="absolute bottom-1/3 left-1/4 w-96 h-96 bg-emerald-500/20 rounded-full blur-3xl" />

      <div className="z-10 w-full max-w-md">
        {/* Stats Section */}
        <Stats
          yourGMs={Number(userStreak || 0)}
          gmsReceived={gmsReceived}
          address={address}
          isLoading={isLoadingStreak}
        />

        {/* Main GM Button */}
        <div className="mt-12 flex justify-center">
          <button
            onClick={handleTapToGM}
            className="relative group"
          >
            {/* Ripple circles */}
            <div className="absolute inset-0 rounded-full bg-teal-400/20 blur-2xl group-hover:bg-teal-400/30 transition-all duration-500" />
            <div className="absolute inset-0 rounded-full bg-teal-400/10 scale-125 blur-3xl group-hover:scale-150 transition-all duration-700" />

            {/* Main button */}
            <div className="relative w-64 h-64 rounded-full bg-gradient-to-br from-cyan-600 to-emerald-500 flex items-center justify-center text-white text-2xl font-bold shadow-2xl group-hover:scale-105 transition-transform">
              <div className="text-center">
                <div className="text-sm opacity-80 mb-2">
                  {mounted && address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Connect Wallet"}
                </div>
                <div className="text-3xl">Tap to GM</div>
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* GM Type Modal */}
      {showModal && (
        <GMModal
          onClose={() => setShowModal(false)}
          address={address}
        />
      )}

      {/* Countdown Timer */}
      {showCountdown && (
        <CountdownTimer
          lastGMTimestamp={Number(lastGMTimestamp)}
          onClose={() => setShowCountdown(false)}
        />
      )}
    </main>
  );
}
