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
import { BN } from "@coral-xyz/anchor";
import { VoltrClient } from "@voltr/vault-sdk";
import {
  assetMintAddress,
  vaultAddress,
  assetTokenProgram,
  lookupTableAddress,
  useLookupTable,
} from "../../config/base";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  ADAPTOR_PROGRAM_ID,
  DISCRIMINATOR,
  JUPITER_LEND_PROGRAM_ID,
  JUPITER_LIQUIDITY_PROGRAM_ID,
  JUPITER_REWARDS_RATE_PROGRAM_ID,
} from "../constants/spot";
import { withdrawStrategyAmount } from "../../config/spot";
import { SYSTEM_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/native/system";

const payerKpFile = fs.readFileSync(process.env.MANAGER_FILE_PATH!, "utf-8");
const payerKpData = JSON.parse(payerKpFile);
const payerSecret = Uint8Array.from(payerKpData);
const payerKp = Keypair.fromSecretKey(payerSecret);
const payer = payerKp.publicKey;

const vault = new PublicKey(vaultAddress);
const vaultAssetMint = new PublicKey(assetMintAddress);
const vaultAssetTokenProgram = new PublicKey(assetTokenProgram);

const connection = new Connection(process.env.HELIUS_RPC_URL!);
const vc = new VoltrClient(connection);
const withdrawAmount = new BN(withdrawStrategyAmount);

const withdrawEarnStrategy = async (
  withdrawAmount: BN,
  vault: PublicKey,
  vaultAssetMint: PublicKey,
  vaultAssetTokenProgram: PublicKey,
  adaptorProgram: PublicKey,
  jupiterLendProgram: PublicKey,
  jupiterLiquidityProgram: PublicKey,
  jupiterRewardsRateProgram: PublicKey,
  fTokenProgram: PublicKey,
  instructionDiscriminator: number[],
  lookupTableAddresses: string[] = []
) => {
  const [fTokenMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("f_token_mint"), vaultAssetMint.toBuffer()],
    jupiterLendProgram
  );

  const [lendingAdmin] = PublicKey.findProgramAddressSync(
    [Buffer.from("lending_admin")],
    jupiterLendProgram
  );

  const [lending] = PublicKey.findProgramAddressSync(
    [Buffer.from("lending"), vaultAssetMint.toBuffer(), fTokenMint.toBuffer()],
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

  const { vaultStrategyAuth } = vc.findVaultStrategyAddresses(vault, lending);

  let transactionIxs: TransactionInstruction[] = [];

  const vaultStrategyAssetAta = await setupTokenAccount(
    connection,
    payer,
    vaultAssetMint,
    vaultStrategyAuth,
    transactionIxs,
    vaultAssetTokenProgram
  );

  const vaultStrategyFTokenAta = await setupTokenAccount(
    connection,
    payer,
    fTokenMint,
    vaultStrategyAuth,
    transactionIxs,
    fTokenProgram
  );

  const jVault = getAssociatedTokenAddressSync(
    vaultAssetMint,
    liquidity,
    true,
    vaultAssetTokenProgram
  );

  // Prepare the remaining accounts
  const remainingAccounts = [
    { pubkey: vaultStrategyFTokenAta, isSigner: false, isWritable: true },
    { pubkey: lendingAdmin, isSigner: false, isWritable: false },
    { pubkey: fTokenMint, isSigner: false, isWritable: true },
    { pubkey: supplyTokenReservesLiquidity, isSigner: false, isWritable: true },
    {
      pubkey: lendingSupplyPositionOnLiquidity,
      isSigner: false,
      isWritable: true,
    },
    { pubkey: rateModel, isSigner: false, isWritable: false },
    { pubkey: jVault, isSigner: false, isWritable: true },
    { pubkey: userClaim, isSigner: false, isWritable: true },
    { pubkey: liquidity, isSigner: false, isWritable: true },
    { pubkey: jupiterLiquidityProgram, isSigner: false, isWritable: true },
    { pubkey: rewardsRateModel, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: true },
    { pubkey: jupiterLendProgram, isSigner: false, isWritable: true },
  ];

  const createWithdrawStrategyIx = await vc.createWithdrawStrategyIx(
    {
      instructionDiscriminator: Buffer.from(instructionDiscriminator),
      withdrawAmount,
    },
    {
      manager: payer,
      vault,
      vaultAssetMint,
      assetTokenProgram: vaultAssetTokenProgram,
      strategy: lending,
      remainingAccounts,
      adaptorProgram: new PublicKey(adaptorProgram),
    }
  );

  transactionIxs.push(createWithdrawStrategyIx);

  const lookupTableAccounts = lookupTableAddresses
    ? await getAddressLookupTableAccounts(lookupTableAddresses, connection)
    : [];

  const txSig = await sendAndConfirmOptimisedTx(
    transactionIxs,
    process.env.HELIUS_RPC_URL!,
    payerKp,
    [],
    lookupTableAccounts
  );
  console.log("Jupiter earn withdrawn with signature:", txSig);
};

const main = async () => {
  await withdrawEarnStrategy(
    withdrawAmount,
    vault,
    vaultAssetMint,
    vaultAssetTokenProgram,
    new PublicKey(ADAPTOR_PROGRAM_ID),
    new PublicKey(JUPITER_LEND_PROGRAM_ID),
    new PublicKey(JUPITER_LIQUIDITY_PROGRAM_ID),
    new PublicKey(JUPITER_REWARDS_RATE_PROGRAM_ID),
    new PublicKey(TOKEN_PROGRAM_ID),
    DISCRIMINATOR.WITHDRAW_JUPITER_EARN,
    useLookupTable ? [lookupTableAddress] : []
  );
};

main();
