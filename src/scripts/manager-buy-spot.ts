import "dotenv/config";
import * as fs from "fs";
import {
  AccountMeta,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  getAddressLookupTableAccounts,
  sendAndConfirmOptimisedTx,
  setupTokenAccount,
} from "../utils/helper";
import { VoltrClient } from "@voltr/vault-sdk";
import {
  assetMintAddress,
  vaultAddress,
  assetTokenProgram,
  lookupTableAddress,
  useLookupTable,
} from "../../config/base";
import {
  assetOracleAddress,
  buyForeignAmountInAsset,
  foreignMintAddress,
  foreignOracleAddress,
  foreignTokenProgram,
  jupiterMaxAccounts,
  jupiterSlippageBps,
} from "../../config/spot";
import { ADAPTOR_PROGRAM_ID } from "../constants/spot";
import { DISCRIMINATOR, SEEDS } from "../constants/base";
import { BN } from "@coral-xyz/anchor";
import { setupJupiterSwap } from "../utils/setup-jupiter-swap";

const buySpotHandler = async (
  connection: Connection,
  managerKp: Keypair,
  vault: PublicKey,
  vaultAssetMint: PublicKey,
  assetTokenProgram: PublicKey,
  assetOracle: PublicKey,
  foreignAssetMint: PublicKey,
  foreignTokenProgram: PublicKey,
  foreignOracle: PublicKey,
  adaptorProgram: PublicKey,
  oracleInitReceiptSeed: string,
  buyAmountInAsset: BN,
  jupiterSlippageBps: number,
  jupiterMaxAccounts: number,
  instructionDiscriminator: number[],
  lookupTableAddress: string | null
) => {
  const vc = new VoltrClient(connection);

  const { vaultStrategyAuth } = vc.findVaultStrategyAddresses(
    vault,
    foreignAssetMint
  );

  let transactionIxs: TransactionInstruction[] = [];

  const vaultStrategyAssetAta = await setupTokenAccount(
    connection,
    managerKp.publicKey,
    vaultAssetMint,
    vaultStrategyAuth,
    transactionIxs,
    assetTokenProgram
  );

  const vaultStrategyForeignAta = await setupTokenAccount(
    connection,
    managerKp.publicKey,
    foreignAssetMint,
    vaultStrategyAuth,
    transactionIxs,
    foreignTokenProgram
  );

  const [assetOracleInitReceipt] = PublicKey.findProgramAddressSync(
    [
      Buffer.from(oracleInitReceiptSeed),
      vaultStrategyAuth.toBuffer(),
      vaultAssetMint.toBuffer(),
    ],
    adaptorProgram
  );

  const [foreignOracleInitReceipt] = PublicKey.findProgramAddressSync(
    [
      Buffer.from(oracleInitReceiptSeed),
      vaultStrategyAuth.toBuffer(),
      foreignAssetMint.toBuffer(),
    ],
    adaptorProgram
  );

  const remainingAccounts: AccountMeta[] = [
    {
      pubkey: assetOracle,
      isWritable: false,
      isSigner: false,
    },
    {
      pubkey: assetOracleInitReceipt,
      isWritable: false,
      isSigner: false,
    },
    {
      pubkey: vaultStrategyForeignAta,
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: foreignTokenProgram,
      isWritable: false,
      isSigner: false,
    },
    {
      pubkey: foreignOracle,
      isWritable: false,
      isSigner: false,
    },
    {
      pubkey: foreignOracleInitReceipt,
      isWritable: false,
      isSigner: false,
    },
  ];
  let additionalArgs: Buffer = Buffer.from([]);
  let lookupTableAddresses: string[] = lookupTableAddress
    ? [lookupTableAddress]
    : [];

  if (buyAmountInAsset.gt(new BN(0))) {
    const {
      additionalArgs: additionalArgsTemp,
      lookupTableAddresses: lookupTableAddressesTemp,
    } = await setupJupiterSwap(
      buyAmountInAsset,
      new BN(0),
      vaultStrategyAuth,
      vaultAssetMint,
      foreignAssetMint,
      jupiterSlippageBps,
      jupiterMaxAccounts,
      additionalArgs,
      remainingAccounts,
      lookupTableAddresses
    );

    additionalArgs = additionalArgsTemp;
    lookupTableAddresses = lookupTableAddressesTemp;
  }

  const createDepositStrategyIx = await vc.createDepositStrategyIx(
    {
      depositAmount: buyAmountInAsset,
      instructionDiscriminator: Buffer.from(instructionDiscriminator),
      additionalArgs: additionalArgs.length > 0 ? additionalArgs : null,
    },
    {
      manager: managerKp.publicKey,
      vault,
      vaultAssetMint,
      strategy: foreignAssetMint,
      assetTokenProgram,
      adaptorProgram,
      remainingAccounts,
    }
  );

  transactionIxs.push(createDepositStrategyIx);

  const lookupTableAccounts = lookupTableAddresses
    ? await getAddressLookupTableAccounts(lookupTableAddresses, connection)
    : [];

  const txSig = await sendAndConfirmOptimisedTx(
    transactionIxs,
    process.env.HELIUS_RPC_URL!,
    managerKp,
    [],
    lookupTableAccounts
  );
  console.log("Spot bought with signature:", txSig);
};

const main = async () => {
  const managerKpFile = fs.readFileSync(
    process.env.MANAGER_FILE_PATH!,
    "utf-8"
  );
  const managerKpData = JSON.parse(managerKpFile);
  const managerSecret = Uint8Array.from(managerKpData);
  const managerKp = Keypair.fromSecretKey(managerSecret);

  await buySpotHandler(
    new Connection(process.env.HELIUS_RPC_URL!),
    managerKp,
    new PublicKey(vaultAddress),
    new PublicKey(assetMintAddress),
    new PublicKey(assetTokenProgram),
    new PublicKey(assetOracleAddress),
    new PublicKey(foreignMintAddress),
    new PublicKey(foreignTokenProgram),
    new PublicKey(foreignOracleAddress),
    new PublicKey(ADAPTOR_PROGRAM_ID),
    SEEDS.ORACLE_INIT_RECEIPT,
    new BN(buyForeignAmountInAsset),
    jupiterSlippageBps,
    jupiterMaxAccounts,
    DISCRIMINATOR.SWAP_SPOT,
    useLookupTable ? lookupTableAddress : null
  );
};

main();
