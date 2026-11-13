require('@nomicfoundation/hardhat-ethers');
require('solidity-coverage');
const { subtask } = require('hardhat/config');
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require('hardhat/builtin-tasks/task-names');

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async ({ solcVersion }, _, runSuper) => {
  if (solcVersion !== '0.8.30') return runSuper();
  return {
    compilerPath: require.resolve('solc/soljson.js'),
    isSolcJs: true,
    version: solcVersion,
    longVersion: require('solc').version(),
  };
});

module.exports = {
  solidity: {
    version: '0.8.30',
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris' },
  },
  networks: {
    localhost: { url: 'http://127.0.0.1:8545' },
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC_URL || 'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
      chainId: 97,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
  },
};
