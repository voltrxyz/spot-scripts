import "dotenv/config";
import * as fs from "fs";
import { BN } from "@coral-xyz/anchor";
import {
  address,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
} from "@solana/kit";
import {
  findVaultStrategyAuthPda,
  getWithdrawStrategyInstructionAsync,
} from "@voltr/vault-sdk";
import {
  getAddressesByLookupTable,
  appendRemainingAccounts,
  publicKeyToAddress,
  sendAndConfirmOptimisedTx,
} from "../utils/helper";
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
import { PublicKey } from "@solana/web3.js";

const main = async () => {
  const payerSecret = Uint8Array.from(
    JSON.parse(fs.readFileSync(process.env.MANAGER_FILE_PATH!, "utf-8"))
  );
  const payerSigner = await createKeyPairSignerFromBytes(payerSecret);
  const rpc = createSolanaRpc(process.env.HELIUS_RPC_URL!);
  const withdrawAmount = new BN(withdrawStrategyAmount);

  const vaultAssetMintPk = new PublicKey(assetMintAddress);
  const vaultAssetTokenProgram = new PublicKey(assetTokenProgram);
  const jupiterLendProgram = new PublicKey(JUPITER_LEND_PROGRAM_ID);
  const jupiterLiquidityProgram = new PublicKey(JUPITER_LIQUIDITY_PROGRAM_ID);
  const jupiterRewardsRateProgram = new PublicKey(JUPITER_REWARDS_RATE_PROGRAM_ID);

  const [fTokenMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("f_token_mint"), vaultAssetMintPk.toBuffer()],
    jupiterLendProgram
  );
  const [lendingAdmin] = PublicKey.findProgramAddressSync(
    [Buffer.from("lending_admin")],
    jupiterLendProgram
  );
  const [lending] = PublicKey.findProgramAddressSync(
    [Buffer.from("lending"), vaultAssetMintPk.toBuffer(), fTokenMint.toBuffer()],
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

  const [vaultStrategyAuth] = await findVaultStrategyAuthPda({
    vault: vaultAddress,
    strategy: publicKeyToAddress(lending),
  });

  const vaultStrategyFTokenAta = getAssociatedTokenAddressSync(
    fTokenMint,
    new PublicKey(vaultStrategyAuth),
    true,
    vaultAssetTokenProgram
  );
  const jVault = getAssociatedTokenAddressSync(
    vaultAssetMintPk,
    liquidity,
    true,
    vaultAssetTokenProgram
  );

  const remainingAccounts = [
    { pubkey: vaultStrategyFTokenAta, isSigner: false, isWritable: true },
    { pubkey: lendingAdmin, isSigner: false, isWritable: false },
    { pubkey: fTokenMint, isSigner: false, isWritable: true },
    { pubkey: supplyTokenReservesLiquidity, isSigner: false, isWritable: true },
    { pubkey: lendingSupplyPositionOnLiquidity, isSigner: false, isWritable: true },
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

  const withdrawStrategyIx = await getWithdrawStrategyInstructionAsync({
    manager: payerSigner,
    vault: vaultAddress,
    strategy: publicKeyToAddress(lending),
    vaultAssetMint: assetMintAddress,
    assetTokenProgram,
    adaptorProgram: address(ADAPTOR_PROGRAM_ID),
    amount: BigInt(withdrawAmount.toString()),
    instructionDiscriminator: new Uint8Array(DISCRIMINATOR.WITHDRAW_JUPITER_EARN),
    additionalArgs: null,
  });

  const txSig = await sendAndConfirmOptimisedTx(
    [appendRemainingAccounts(withdrawStrategyIx, remainingAccounts)],
    process.env.HELIUS_RPC_URL!,
    payerSigner,
    useLookupTable && lookupTableAddress
      ? await getAddressesByLookupTable([lookupTableAddress], rpc)
      : {}
  );
  console.log("Jupiter earn withdrawn with signature:", txSig);
};

main();
