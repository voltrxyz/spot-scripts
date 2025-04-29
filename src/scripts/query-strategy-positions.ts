import "dotenv/config";
import { createSolanaRpc } from "@solana/kit";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  VoltrClient,
  fetchAllStrategyInitReceiptAccountsOfVault,
  fetchVault,
} from "@voltr/vault-sdk";
import { vaultAddress } from "../../config/base";
import { Connection, PublicKey } from "@solana/web3.js";

const main = async () => {
  const rpc = createSolanaRpc(process.env.HELIUS_RPC_URL!);
  const connection = new Connection(process.env.HELIUS_RPC_URL!);
  const vc = new VoltrClient(connection);
  const vault = new PublicKey(vaultAddress);

  const vaultAccount = await fetchVault(rpc, vaultAddress);
  console.log(
    "vaultTotalPosition:",
    vaultAccount.data.asset.totalValue.toString()
  );

  const allocations = await fetchAllStrategyInitReceiptAccountsOfVault(
    rpc,
    vaultAddress
  );

  for (const allocation of allocations) {
    console.log("--------------------------------");
    console.log("Allocation Public Key: ", allocation.address);
    console.log("Mint: ", allocation.data.strategy);
    console.log(
      "Last Refreshed Value (Denominated in Asset): ",
      allocation.data.positionValue.toString()
    );

    const foreignTokenProgram = await connection
      .getAccountInfo(new PublicKey(allocation.data.strategy))
      .then((accInfo) => accInfo?.owner);

    const strategyAuthority = vc.findVaultStrategyAuth(
      vault,
      new PublicKey(allocation.data.strategy)
    );

    const strategyForeignAta = getAssociatedTokenAddressSync(
      new PublicKey(allocation.data.strategy),
      strategyAuthority,
      true,
      foreignTokenProgram
    );

    const strategyForeignBalance = await connection
      .getTokenAccountBalance(strategyForeignAta)
      .then((balance) => balance.value.amount);

    console.log(
      "Current Raw Amount (Denominated in Foreign): ",
      strategyForeignBalance
    );
  }
};

main();
