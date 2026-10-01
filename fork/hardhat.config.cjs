/**
 * In-process fork of Robinhood Chain (id 4663) at the latest block.
 * The public RPC only keeps recent state, so a fork lives a few minutes:
 * serve, rehearse, done.
 */
module.exports = {
  solidity: "0.8.28",
  networks: {
    hardhat: {
      chainId: 4663,
      chains: { 4663: { hardforkHistory: { cancun: 0 } } },
      forking: { url: process.env.FORK_URL || "https://rpc.mainnet.chain.robinhood.com" },
    },
  },
};
