import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

const JUP_ENDPOINT = "https://lite-api.jup.ag/swap/v1";

export async function setupJupiterSwap(
  amountIn: BN,
  minimumThresholdAmountOut: BN,
  authority: PublicKey,
  inputMint: PublicKey,
  outputMint: PublicKey,
  slippageBps: number,
  maxAccounts: number,
  additionalArgsBase: Buffer,
  remainingAccounts: {
    pubkey: PublicKey;
    isSigner: boolean;
    isWritable: boolean;
  }[],
  lookupTableAddressesBase: string[]
): Promise<{
  lookupTableAddresses: string[];
  additionalArgs: Buffer;
}> {
  let additionalArgs = additionalArgsBase;

  if (amountIn && amountIn.gt(new BN(0))) {
    try {
      // Get Jupiter quote
      const jupQuoteResponse = await (
        await fetch(
          `${JUP_ENDPOINT}/quote?inputMint=${inputMint.toBase58()}` +
            `&outputMint=${outputMint.toBase58()}` +
            `&amount=${amountIn.toString()}` +
            `&slippageBps=${slippageBps}` +
            `&maxAccounts=${maxAccounts}`
        )
      ).json();

      if (
        new BN(jupQuoteResponse.otherAmountThreshold).lt(
          minimumThresholdAmountOut
        )
      )
        throw new Error("Jupiter swap otherAmountThreshold is too low");

      // Get Jupiter swap instructions
      const instructions = await (
        await fetch(`${JUP_ENDPOINT}/swap-instructions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            quoteResponse: jupQuoteResponse,
            userPublicKey: authority.toBase58(),
          }),
        })
      ).json();

      if (instructions.error) {
        throw new Error(
          "Failed to get swap instructions: " + instructions.error
        );
      }

      const {
        swapInstruction,
        addressLookupTableAddresses,
      } = instructions;

      lookupTableAddressesBase.push(...addressLookupTableAddresses);

      remainingAccounts.push(
        {
          pubkey: new PublicKey(swapInstruction.programId),
          isSigner: false,
          isWritable: false,
        },
        ...swapInstruction.accounts.map((key: any) => ({
          pubkey: new PublicKey(key.pubkey),
          isSigner: false,
          isWritable: key.isWritable,
        }))
      );

      const jupSwapData = Buffer.from(swapInstruction.data, "base64");
      const bufferLength = additionalArgs.length + jupSwapData.length;
      additionalArgs = Buffer.concat(
        [additionalArgs, jupSwapData],
        bufferLength
      );
    } catch (error) {
      console.error("Error setting up Jupiter swap:", error);
      throw error;
    }
  }

  return {
    lookupTableAddresses: lookupTableAddressesBase,
    additionalArgs,
  };
}
