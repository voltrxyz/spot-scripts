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
  appendRemainingAccounts,
  publicKeyToAddress,
  sendAndConfirmOptimisedTx,
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
  assetOracleAddress,
  foreignMintAddress,
  foreignOracleAddress,
  foreignTokenProgram,
} from "../../config/spot";
import { ADAPTOR_PROGRAM_ID, DISCRIMINATOR, SEEDS } from "../constants/spot";
import { PublicKey } from "@solana/web3.js";

const main = async () => {
  const payerSecret = Uint8Array.from(
    JSON.parse(fs.readFileSync(process.env.ADMIN_FILE_PATH!, "utf-8"))
  );
  const payerSigner = await createKeyPairSignerFromBytes(payerSecret);
  const rpc = createSolanaRpc(process.env.HELIUS_RPC_URL!);

  const vaultAssetMintPk = new PublicKey(assetMintAddress);
  const foreignAssetMint = new PublicKey(foreignMintAddress);
  const assetTokenProgramPk = new PublicKey(assetTokenProgram);
  const foreignTokenProgramPk = new PublicKey(foreignTokenProgram);
  const adaptorProgram = new PublicKey(ADAPTOR_PROGRAM_ID);

  const [vaultStrategyAuth] = await findVaultStrategyAuthPda({
    vault: vaultAddress,
    strategy: publicKeyToAddress(foreignAssetMint),
  });

  const transactionIxs: Instruction[] = [];

  const vaultStrategyAssetAta = await setupTokenAccount(
    rpc,
    payerSigner,
    assetMintAddress,
    vaultStrategyAuth,
    transactionIxs,
    assetTokenProgram
  );

  const vaultStrategyForeignAta = await setupTokenAccount(
    rpc,
    payerSigner,
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
    adaptorProgram
  );

  const [foreignOracleInitReceipt] = PublicKey.findProgramAddressSync(
    [
      Buffer.from(SEEDS.ORACLE_INIT_RECEIPT),
      new PublicKey(vaultStrategyAuth).toBuffer(),
      foreignAssetMint.toBuffer(),
    ],
    adaptorProgram
  );

  const initializeStrategyIx = await getInitializeStrategyInstructionAsync({
    payer: payerSigner,
    manager: payerSigner,
    vault: vaultAddress,
    strategy: publicKeyToAddress(foreignAssetMint),
    adaptorProgram: address(ADAPTOR_PROGRAM_ID),
    instructionDiscriminator: new Uint8Array(DISCRIMINATOR.INITIALIZE_SPOT),
    additionalArgs: null,
  });

  transactionIxs.push(
    appendRemainingAccounts(initializeStrategyIx, [
      { pubkey: vaultAssetMintPk, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(vaultStrategyAssetAta), isSigner: false, isWritable: false },
      { pubkey: assetTokenProgramPk, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(assetOracleAddress), isSigner: false, isWritable: false },
      { pubkey: assetOracleInitReceipt, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(vaultStrategyForeignAta), isSigner: false, isWritable: false },
      { pubkey: foreignTokenProgramPk, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(foreignOracleAddress), isSigner: false, isWritable: false },
      { pubkey: foreignOracleInitReceipt, isSigner: false, isWritable: true },
    ])
  );

  const txSig = await sendAndConfirmOptimisedTx(
    transactionIxs,
    process.env.HELIUS_RPC_URL!,
    payerSigner,
    useLookupTable && lookupTableAddress
      ? await getAddressesByLookupTable([lookupTableAddress], rpc)
      : {}
  );
  console.log("Spot initialized with signature:", txSig);
};

main();
