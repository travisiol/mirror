/** The exact text a wallet signs to open a session. Built identically on both sides. */
export function signInMessage(input: { host: string; address: string; nonce: string; issuedAt: string }): string {
  return [
    `${input.host} wants you to sign in to mirror with your wallet:`,
    input.address,
    "",
    "Signing in lets you save your subscriptions and see your own records. It costs no gas and moves no funds.",
    "",
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
  ].join("\n");
}
