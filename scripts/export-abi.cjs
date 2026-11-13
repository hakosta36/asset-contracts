const fs = require('node:fs');
const path = require('node:path');
const artifact = require('../artifacts/contracts/OracleAsset.sol/OracleAsset.json');
const target = path.join(__dirname, '..', 'abi');
fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(
  path.join(target, 'OracleAsset.json'),
  JSON.stringify(artifact.abi, null, 2) + '\n',
);
