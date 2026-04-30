import "dotenv/config";
import * as fs from "fs";
import { AccountMeta, PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import {
  address,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  type Instruction,
} from "@solana/kit";
import {
  findVaultStrategyAuthPda,
  getDepositStrategyInstructionAsync,
} from "@voltr/vault-sdk";
import {
  getAddressesByLookupTable,
  appendRemainingAccounts,
  publicKeyToAddress,
  sendAndConfirmOptimisedTx,
  setupTokenAccount,
} from "../utils/helper";
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
import { ADAPTOR_PROGRAM_ID, DISCRIMINATOR, SEEDS } from "../constants/spot";
import { setupJupiterSwap } from "../utils/setup-jupiter-swap";

const main = async () => {
  const managerSecret = Uint8Array.from(
    JSON.parse(fs.readFileSync(process.env.MANAGER_FILE_PATH!, "utf-8"))
  );
  const managerSigner = await createKeyPairSignerFromBytes(managerSecret);
  const rpc = createSolanaRpc(process.env.HELIUS_RPC_URL!);

  const vaultAssetMintPk = new PublicKey(assetMintAddress);
  const foreignAssetMint = new PublicKey(foreignMintAddress);
  const assetTokenProgramPk = new PublicKey(assetTokenProgram);
  const foreignTokenProgramPk = new PublicKey(foreignTokenProgram);
  const buyAmountInAsset = new BN(buyForeignAmountInAsset);

  const [vaultStrategyAuth] = await findVaultStrategyAuthPda({
    vault: vaultAddress,
    strategy: publicKeyToAddress(foreignAssetMint),
  });

  const transactionIxs: Instruction[] = [];

  const vaultStrategyAssetAta = await setupTokenAccount(
    rpc,
    managerSigner,
    assetMintAddress,
    vaultStrategyAuth,
    transactionIxs,
    assetTokenProgram
  );

  const vaultStrategyForeignAta = await setupTokenAccount(
    rpc,
    managerSigner,
    publicKeyToAddress(foreignAssetMint),
    vaultStrategyAuth,
    transactionIxs,
    publicKeyToAddress(foreignTokenProgramPk)
  );

  const [assetOracleInitReceipt] = PublicKey.findProgramAddressSync(
    [
      Buffer.from(SEEDS.ORACLE_INIT_RECEIPT),
      new PublicKey(vaultStrategyAuth).toBuffer(),
      vaultAssetMintPk.toBuffer(),
    ],
    new PublicKey(ADAPTOR_PROGRAM_ID)
  );
  const [foreignOracleInitReceipt] = PublicKey.findProgramAddressSync(
    [
      Buffer.from(SEEDS.ORACLE_INIT_RECEIPT),
      new PublicKey(vaultStrategyAuth).toBuffer(),
      foreignAssetMint.toBuffer(),
    ],
    new PublicKey(ADAPTOR_PROGRAM_ID)
  );

  const remainingAccounts: AccountMeta[] = [
    { pubkey: new PublicKey(assetOracleAddress), isWritable: false, isSigner: false },
    { pubkey: assetOracleInitReceipt, isWritable: false, isSigner: false },
    { pubkey: new PublicKey(vaultStrategyForeignAta), isWritable: true, isSigner: false },
    { pubkey: foreignTokenProgramPk, isWritable: false, isSigner: false },
    { pubkey: new PublicKey(foreignOracleAddress), isWritable: false, isSigner: false },
    { pubkey: foreignOracleInitReceipt, isWritable: false, isSigner: false },
  ];

  let additionalArgs: Buffer = Buffer.from([]);
  let lookupTableAddresses: string[] = useLookupTable ? [lookupTableAddress] : [];

  if (buyAmountInAsset.gt(new BN(0))) {
    const setup = await setupJupiterSwap(
      buyAmountInAsset,
      new BN(0),
      new PublicKey(vaultStrategyAuth),
      vaultAssetMintPk,
      foreignAssetMint,
      jupiterSlippageBps,
      jupiterMaxAccounts,
      additionalArgs,
      remainingAccounts,
      lookupTableAddresses
    );
    additionalArgs = setup.additionalArgs;
    lookupTableAddresses = setup.lookupTableAddresses;
  }

  const depositStrategyIx = await getDepositStrategyInstructionAsync({
    manager: managerSigner,
    vault: vaultAddress,
    strategy: publicKeyToAddress(foreignAssetMint),
    vaultAssetMint: assetMintAddress,
    assetTokenProgram,
    adaptorProgram: address(ADAPTOR_PROGRAM_ID),
    amount: BigInt(buyAmountInAsset.toString()),
    instructionDiscriminator: new Uint8Array(DISCRIMINATOR.SWAP_SPOT),
    additionalArgs: additionalArgs.length > 0 ? new Uint8Array(additionalArgs) : null,
  });

  transactionIxs.push(appendRemainingAccounts(depositStrategyIx, remainingAccounts));

  const txSig = await sendAndConfirmOptimisedTx(
    transactionIxs,
    process.env.HELIUS_RPC_URL!,
    managerSigner,
    lookupTableAddresses.length > 0
      ? await getAddressesByLookupTable(
          lookupTableAddresses.map((value) => address(value)),
          rpc
        )
      : {}
  );
  console.log("Spot bought with signature:", txSig);
};

main();
