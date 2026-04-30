import "dotenv/config";
import * as fs from "fs";
import {
  address,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  type Address,
  type Instruction,
} from "@solana/kit";
import { getInitializeDirectWithdrawStrategyInstructionAsync } from "@voltr/vault-sdk";
import {
  sendAndConfirmOptimisedTx,
  setupAddressLookupTable,
} from "../utils/helper";
import {
  lookupTableAddress,
  useLookupTable,
  assetMintAddress,
  vaultAddress,
} from "../../config/base";
import { ADAPTOR_PROGRAM_ID, JUPITER_LEND_PROGRAM_ID } from "../constants/spot";
import { directWithdrawDiscriminator } from "../../config/spot";
import { PublicKey } from "@solana/web3.js";

const main = async () => {
  const payerSecret = Uint8Array.from(
    JSON.parse(fs.readFileSync(process.env.ADMIN_FILE_PATH!, "utf-8"))
  );
  const payerSigner = await createKeyPairSignerFromBytes(payerSecret);
  const adminSigner = await createKeyPairSignerFromBytes(payerSecret);

  const vaultAssetMint = new PublicKey(assetMintAddress);
  const jupiterLendProgram = new PublicKey(JUPITER_LEND_PROGRAM_ID);

  const [fTokenMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("f_token_mint"), vaultAssetMint.toBuffer()],
    jupiterLendProgram
  );

  const [lending] = PublicKey.findProgramAddressSync(
    [Buffer.from("lending"), vaultAssetMint.toBuffer(), fTokenMint.toBuffer()],
    jupiterLendProgram
  );

  const initializeDirectWithdrawIx =
    await getInitializeDirectWithdrawStrategyInstructionAsync({
      payer: payerSigner,
      admin: adminSigner,
      vault: vaultAddress,
      strategy: address(lending.toBase58()),
      adaptorProgram: address(ADAPTOR_PROGRAM_ID),
      instructionDiscriminator: new Uint8Array(directWithdrawDiscriminator),
      additionalArgs: null,
      allowUserArgs: false,
    });

  const txSig = await sendAndConfirmOptimisedTx(
    [initializeDirectWithdrawIx],
    process.env.HELIUS_RPC_URL!,
    payerSigner
  );
  console.log(
    "Jupiter direct withdraw strategy initialized with signature:",
    txSig
  );

  if (useLookupTable) {
    const transactionIxs1: Instruction[] = [];
    const ixAddresses: Address[] = Array.from(
      new Set(
        (initializeDirectWithdrawIx.accounts ?? []).map((a) => a.address as Address)
      )
    );

    await setupAddressLookupTable(
      createSolanaRpc(process.env.HELIUS_RPC_URL!),
      payerSigner,
      adminSigner,
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
