import "dotenv/config";
import { Connection, PublicKey } from "@solana/web3.js";
import { VoltrClient } from "@voltr/vault-sdk";
import { vaultAddress } from "../../config/base";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

const vault = new PublicKey(vaultAddress);

const connection = new Connection(process.env.HELIUS_RPC_URL!);
const vc = new VoltrClient(connection);

const queryAllInitStrategies = async () => {
  const vaultAccount = await vc.fetchVaultAccount(vault);
  const vaultTotalPosition = vaultAccount.asset.totalValue;
  console.log("vaultTotalPosition: ", vaultTotalPosition.toString());
  const allocations = await vc.fetchAllStrategyInitReceiptAccountsOfVault(
    vault
  );

  for (const allocation of allocations) {
    console.log("--------------------------------");
    console.log("Allocation Public Key: ", allocation.publicKey.toBase58());
    console.log("Mint: ", allocation.account.strategy.toBase58());
    console.log(
      "Last Refreshed Value (Denominated in Asset): ",
      allocation.account.positionValue.toString()
    );

    const foreignTokenProgram = await connection
      .getAccountInfo(allocation.account.strategy)
      .then((accInfo) => accInfo?.owner);

    const strategyAuthority = vc.findVaultStrategyAuth(
      vault,
      allocation.account.strategy
    );

    const strategyForeignAta = getAssociatedTokenAddressSync(
      allocation.account.strategy,
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

const main = async () => {
  await queryAllInitStrategies();
};

main();
