import "dotenv/config";
import * as fs from "fs";
import {
  address,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  type Address,
  type Instruction,
} from "@solana/kit";
import {
  findVaultStrategyAuthPda,
  getInitializeStrategyInstructionAsync,
} from "@voltr/vault-sdk";
import {
  getAddressesByLookupTable,
  publicKeyToAddress,
  sendAndConfirmOptimisedTx,
  setupAddressLookupTable,
  setupTokenAccount,
} from "../utils/helper";
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
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

const main = async () => {
  const payerSecret = Uint8Array.from(
    JSON.parse(fs.readFileSync(process.env.ADMIN_FILE_PATH!, "utf-8"))
  );
  const payerSigner = await createKeyPairSignerFromBytes(payerSecret);
  const rpc = createSolanaRpc(process.env.HELIUS_RPC_URL!);

  const vaultAssetMintPk = new PublicKey(assetMintAddress);
  const assetTokenProgramPk = new PublicKey(assetTokenProgram);
  const jupiterLendProgram = new PublicKey(JUPITER_LEND_PROGRAM_ID);
  const jupiterLiquidityProgram = new PublicKey(JUPITER_LIQUIDITY_PROGRAM_ID);
  const jupiterRewardsRateProgram = new PublicKey(JUPITER_REWARDS_RATE_PROGRAM_ID);

  const [fTokenMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("f_token_mint"), vaultAssetMintPk.toBuffer()],
    jupiterLendProgram
  );

  const [lending] = PublicKey.findProgramAddressSync(
    [Buffer.from("lending"), vaultAssetMintPk.toBuffer(), fTokenMint.toBuffer()],
    jupiterLendProgram
  );

  const [vaultStrategyAuth] = await findVaultStrategyAuthPda({
    vault: vaultAddress,
    strategy: publicKeyToAddress(lending),
  });

  const transactionIxs: Instruction[] = [];

  await setupTokenAccount(
    rpc,
    payerSigner,
    assetMintAddress,
    vaultStrategyAuth,
    transactionIxs,
    assetTokenProgram
  );

  await setupTokenAccount(
    rpc,
    payerSigner,
    publicKeyToAddress(fTokenMint),
    vaultStrategyAuth,
    transactionIxs,
    assetTokenProgram
  );

  const initializeStrategyIx = await getInitializeStrategyInstructionAsync({
    payer: payerSigner,
    manager: payerSigner,
    vault: vaultAddress,
    strategy: publicKeyToAddress(lending),
    adaptorProgram: address(ADAPTOR_PROGRAM_ID),
    instructionDiscriminator: new Uint8Array(DISCRIMINATOR.INITIALIZE_JUPITER_EARN),
    additionalArgs: null,
  });

  transactionIxs.push(initializeStrategyIx);

  const lookupTables =
    useLookupTable && lookupTableAddress
      ? await getAddressesByLookupTable([lookupTableAddress], rpc)
      : {};

  const txSig = await sendAndConfirmOptimisedTx(
    transactionIxs,
    process.env.HELIUS_RPC_URL!,
    payerSigner,
    lookupTables
  );
  console.log("Jupiter earn initialized with signature:", txSig);

  if (useLookupTable && lookupTableAddress) {
    const transactionIxs1: Instruction[] = [];

    const [lendingAdmin] = PublicKey.findProgramAddressSync(
      [Buffer.from("lending_admin")],
      jupiterLendProgram
    );

    const [supplyTokenReservesLiquidity] = PublicKey.findProgramAddressSync(
      [Buffer.from("reserve"), vaultAssetMintPk.toBuffer()],
      jupiterLiquidityProgram
    );

    const [rateModel] = PublicKey.findProgramAddressSync(
      [Buffer.from("rate_model"), vaultAssetMintPk.toBuffer()],
      jupiterLiquidityProgram
    );

    const [userClaim] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_claim"), lendingAdmin.toBuffer(), vaultAssetMintPk.toBuffer()],
      jupiterLiquidityProgram
    );

    const [liquidity] = PublicKey.findProgramAddressSync(
      [Buffer.from("liquidity")],
      jupiterLiquidityProgram
    );

    const [rewardsRateModel] = PublicKey.findProgramAddressSync(
      [Buffer.from("lending_rewards_rate_model"), vaultAssetMintPk.toBuffer()],
      jupiterRewardsRateProgram
    );

    const [lendingSupplyPositionOnLiquidity] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_supply_position"),
        vaultAssetMintPk.toBuffer(),
        lending.toBuffer(),
      ],
      jupiterLiquidityProgram
    );

    const jVault = getAssociatedTokenAddressSync(
      vaultAssetMintPk,
      liquidity,
      true,
      assetTokenProgramPk
    );

    const ixAddresses: Address[] = Array.from(
      new Set([
        ...(initializeStrategyIx.accounts ?? []).map((a) => a.address as Address),
        publicKeyToAddress(fTokenMint),
        publicKeyToAddress(lendingAdmin),
        publicKeyToAddress(supplyTokenReservesLiquidity),
        publicKeyToAddress(rateModel),
        publicKeyToAddress(userClaim),
        publicKeyToAddress(liquidity),
        publicKeyToAddress(rewardsRateModel),
        publicKeyToAddress(lendingSupplyPositionOnLiquidity),
        publicKeyToAddress(jVault),
      ])
    );

    await setupAddressLookupTable(
      rpc,
      payerSigner,
      payerSigner,
      ixAddresses,
      transactionIxs1,
      lookupTableAddress
    );

    const txSig1 = await sendAndConfirmOptimisedTx(
      transactionIxs1,
      process.env.HELIUS_RPC_URL!,
      payerSigner,
      undefined,
      50_000
    );

    console.log(`LUT updated with signature: ${txSig1}`);
  }
};

main();
