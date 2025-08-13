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
  ADAPTOR_PROGRAM_ID,
  DISCRIMINATOR,
  JUPITER_LEND_PROGRAM_ID,
} from "../constants/spot";

const initializeSpotHandler = async (
  connection: Connection,
  payerKp: Keypair,
  managerKp: Keypair,
  vault: PublicKey,
  vaultAssetMint: PublicKey,
  assetTokenProgram: PublicKey,
  adaptorProgram: PublicKey,
  jupiterLendProgram: PublicKey,
  instructionDiscriminator: number[],
  lookupTableAddress: string | null
) => {
  const vc = new VoltrClient(connection);

  const [fTokenMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("f_token_mint"), vaultAssetMint.toBuffer()],
    jupiterLendProgram
  );

  const [lending] = PublicKey.findProgramAddressSync(
    [Buffer.from("lending"), vaultAssetMint.toBuffer(), fTokenMint.toBuffer()],
    jupiterLendProgram
  );

  const { vaultStrategyAuth } = vc.findVaultStrategyAddresses(vault, lending);

  let transactionIxs: TransactionInstruction[] = [];

  const vaultStrategyAssetAta = await setupTokenAccount(
    connection,
    managerKp.publicKey,
    vaultAssetMint,
    vaultStrategyAuth,
    transactionIxs,
    assetTokenProgram
  );

  const createInitializeStrategyIx = await vc.createInitializeStrategyIx(
    {
      instructionDiscriminator: Buffer.from(instructionDiscriminator),
    },
    {
      payer: payerKp.publicKey,
      manager: managerKp.publicKey,
      vault,
      strategy: lending,
      adaptorProgram,
      remainingAccounts: [],
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
  console.log("Jupiter earn initialized with signature:", txSig);
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
    new PublicKey(ADAPTOR_PROGRAM_ID),
    new PublicKey(JUPITER_LEND_PROGRAM_ID),
    DISCRIMINATOR.INITIALIZE_JUPITER_EARN,
    useLookupTable ? lookupTableAddress : null
  );
};

main();
