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
  setupAddressLookupTable,
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
  JUPITER_LIQUIDITY_PROGRAM_ID,
  JUPITER_REWARDS_RATE_PROGRAM_ID,
} from "../constants/spot";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const initializeSpotHandler = async (
  connection: Connection,
  payerKp: Keypair,
  adminKp: Keypair,
  managerKp: Keypair,
  vault: PublicKey,
  vaultAssetMint: PublicKey,
  assetTokenProgram: PublicKey,
  adaptorProgram: PublicKey,
  jupiterLendProgram: PublicKey,
  jupiterLiquidityProgram: PublicKey,
  jupiterRewardsRateProgram: PublicKey,
  fTokenProgram: PublicKey,
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
    payerKp.publicKey,
    vaultAssetMint,
    vaultStrategyAuth,
    transactionIxs,
    assetTokenProgram
  );

  const vaultStrategyFTokenAta = await setupTokenAccount(
    connection,
    payerKp.publicKey,
    fTokenMint,
    vaultStrategyAuth,
    transactionIxs,
    fTokenProgram
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

  if (lookupTableAddress) {
    const transactionIxs1: TransactionInstruction[] = [];

    const [lendingAdmin] = PublicKey.findProgramAddressSync(
      [Buffer.from("lending_admin")],
      jupiterLendProgram
    );

    const [supplyTokenReservesLiquidity] = PublicKey.findProgramAddressSync(
      [Buffer.from("reserve"), vaultAssetMint.toBuffer()],
      jupiterLiquidityProgram
    );

    const [rateModel] = PublicKey.findProgramAddressSync(
      [Buffer.from("rate_model"), vaultAssetMint.toBuffer()],
      jupiterLiquidityProgram
    );

    const [userClaim] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_claim"),
        lendingAdmin.toBuffer(),
        vaultAssetMint.toBuffer(),
      ],
      jupiterLiquidityProgram
    );

    const [liquidity] = PublicKey.findProgramAddressSync(
      [Buffer.from("liquidity")],
      jupiterLiquidityProgram
    );

    const [rewardsRateModel] = PublicKey.findProgramAddressSync(
      [Buffer.from("lending_rewards_rate_model"), vaultAssetMint.toBuffer()],
      jupiterRewardsRateProgram
    );

    const [lendingSupplyPositionOnLiquidity] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_supply_position"),
        vaultAssetMint.toBuffer(),
        lending.toBuffer(),
      ],
      jupiterLiquidityProgram
    );

    const jVault = getAssociatedTokenAddressSync(
      vaultAssetMint,
      liquidity,
      true,
      assetTokenProgram
    );

    const lut = await setupAddressLookupTable(
      connection,
      payerKp.publicKey,
      adminKp.publicKey,
      [
        ...new Set(
          transactionIxs.flatMap((ix) =>
            ix.keys.map((k) => k.pubkey.toBase58())
          )
        ),
        fTokenMint.toBase58(),
        lendingAdmin.toBase58(),
        supplyTokenReservesLiquidity.toBase58(),
        rateModel.toBase58(),
        userClaim.toBase58(),
        liquidity.toBase58(),
        rewardsRateModel.toBase58(),
        lendingSupplyPositionOnLiquidity.toBase58(),
        jVault.toBase58(),
      ],
      transactionIxs1,
      new PublicKey(lookupTableAddress)
    );

    const txSig1 = await sendAndConfirmOptimisedTx(
      transactionIxs1,
      process.env.HELIUS_RPC_URL!,
      payerKp,
      [adminKp],
      undefined,
      50_000
    );

    console.log(`LUT updated with signature: ${txSig1}`);
  }
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
    payerKp,
    new PublicKey(vaultAddress),
    new PublicKey(assetMintAddress),
    new PublicKey(assetTokenProgram),
    new PublicKey(ADAPTOR_PROGRAM_ID),
    new PublicKey(JUPITER_LEND_PROGRAM_ID),
    new PublicKey(JUPITER_LIQUIDITY_PROGRAM_ID),
    new PublicKey(JUPITER_REWARDS_RATE_PROGRAM_ID),
    TOKEN_PROGRAM_ID,
    DISCRIMINATOR.INITIALIZE_JUPITER_EARN,
    useLookupTable ? lookupTableAddress : null
  );
};

main();
