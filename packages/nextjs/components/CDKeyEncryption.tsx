"use client";

import { useEffect, useState } from "react";

import { notification } from "~~/utils/scaffold-eth";

export function CDKeyEncryption() {
  const [encryptionKey, setEncryptionKey] = useState<string>("");
  const [encryptedData, setEncryptedData] = useState<string>("");
  const [isMetaMaskAvailable, setIsMetaMaskAvailable] = useState(false);

  useEffect(() => {
    // Check if MetaMask is available
    if (typeof window !== "undefined" && typeof window.ethereum !== "undefined") {
      setIsMetaMaskAvailable(true);
    }
  }, []);

  async function getEncryptionPublicKey() {
    if (!window.ethereum) {
      notification.error("MetaMask not detected");
      return;
    }

    try {
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });

      // Get user's encryption public key (NOT their wallet address)
      const encryptionPublicKey = await window.ethereum.request({
        method: "eth_getEncryptionPublicKey",
        params: [accounts[0]],
      });

      setEncryptionKey(encryptionPublicKey);
      notification.success("Encryption key retrieved!");
      return encryptionPublicKey;
    } catch (error) {
      console.error(error);
      notification.error("Failed to get encryption key");
    }
  }

  async function decryptWithMetaMask(encryptedDataHex: string) {
    if (!window.ethereum) {
      notification.error("MetaMask not detected");
      return;
    }

    try {
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });

      // MetaMask decrypts using the user's private key
      const decryptedMessage = await window.ethereum.request({
        method: "eth_decrypt",
        params: [encryptedDataHex, accounts[0]],
      });

      notification.success("CD Key decrypted!");
      return decryptedMessage;
    } catch (error) {
      console.error(error);
      notification.error("Failed to decrypt");
    }
  }

  async function handleMintWithEncryption() {
    try {
      // Step 1: Get encryption key
      const pubKey = await getEncryptionPublicKey();
      if (!pubKey) return;

      // Step 2: Request encrypted CD key from your API
      const response = await fetch("/api/mint/get-cd-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ encryptionPublicKey: pubKey }),
      });

      const { encryptedCDKey } = await response.json();
      setEncryptedData(encryptedCDKey);

      // Step 3: Decrypt with MetaMask
      const cdKey = await decryptWithMetaMask(encryptedCDKey);

      notification.success(`Your CD Key: ${cdKey}`);
    } catch (error) {
      console.error(error);
      notification.error("Minting failed");
    }
  }

  if (!isMetaMaskAvailable) {
    return <div className="alert alert-warning">Please install MetaMask to continue</div>;
  }

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <h2 className="card-title">Mint NFT with CD Key (NFT will be SoulBound!)</h2>

        <button className="btn btn-primary" onClick={handleMintWithEncryption}>
          Get Encrypted CD Key & Mint
        </button>

        {encryptionKey && (
          <div className="text-xs break-all">
            <strong>Encryption Key:</strong> {encryptionKey}
          </div>
        )}

        {encryptedData && (
          <div className="text-xs break-all">
            <strong>Encrypted Data:</strong> {encryptedData.slice(0, 50)}...
          </div>
        )}
      </div>
    </div>
  );
}
