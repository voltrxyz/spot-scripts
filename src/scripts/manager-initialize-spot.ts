import "dotenv/config";
import * as fs from "fs";
import {
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
  useLookupTable,
  lookupTableAddress,
} from "../../config/base";
import {
  assetOracleAddress,
  foreignMintAddress,
  foreignOracleAddress,
  foreignTokenProgram,
} from "../../config/spot";
import { ADAPTOR_PROGRAM_ID, DISCRIMINATOR, SEEDS } from "../constants/spot";

const initializeSpotHandler = async (
  connection: Connection,
  payerKp: Keypair,
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

  const createInitializeStrategyIx = await vc.createInitializeStrategyIx(
    {
      instructionDiscriminator: Buffer.from(instructionDiscriminator),
    },
    {
      payer: payerKp.publicKey,
      manager: managerKp.publicKey,
      vault,
      strategy: foreignAssetMint,
      remainingAccounts: [
        {
          pubkey: vaultAssetMint,
          isWritable: false,
          isSigner: false,
        },
        {
          pubkey: vaultStrategyAssetAta,
          isWritable: false,
          isSigner: false,
        },
        {
          pubkey: assetTokenProgram,
          isWritable: false,
          isSigner: false,
        },
        {
          pubkey: assetOracle,
          isWritable: false,
          isSigner: false,
        },
        {
          pubkey: assetOracleInitReceipt,
          isWritable: true,
          isSigner: false,
        },
        {
          pubkey: vaultStrategyForeignAta,
          isWritable: false,
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
          isWritable: true,
          isSigner: false,
        },
      ],
      adaptorProgram,
    }
  );

  transactionIxs.push(createInitializeStrategyIx);

  const lookupTableAccounts = lookupTableAddress
    ? await getAddressLookupTableAccounts([lookupTableAddress], connection)
    : [];

  const txSig = await sendAndConfirmOptimisedTx(
    transactionIxs,
    process.env.HELIUS_RPC_URL!,
    managerKp,
    [],
    lookupTableAccounts
  );
  console.log("Spot initialized with signature:", txSig);
};

const main = async () => {
  const payerKpFile = fs.readFileSync(process.env.MANAGER_FILE_PATH!, "utf-8");
  const payerKpData = JSON.parse(payerKpFile);
  const payerSecret = Uint8Array.from(payerKpData);
  const payerKp = Keypair.fromSecretKey(payerSecret);

  await initializeSpotHandler(
    new Connection(process.env.HELIUS_RPC_URL!),
    payerKp,
    payerKp,
    new PublicKey(vaultAddress),
    new PublicKey(assetMintAddress),
    new PublicKey(assetTokenProgram),
    new PublicKey(assetOracleAddress),
    new PublicKey(foreignMintAddress),
    new PublicKey(foreignTokenProgram),
    new PublicKey(foreignOracleAddress),
    new PublicKey(ADAPTOR_PROGRAM_ID),
    SEEDS.ORACLE_INIT_RECEIPT,
    DISCRIMINATOR.INITIALIZE_SPOT,
    useLookupTable ? lookupTableAddress : null
  );
};

main();
