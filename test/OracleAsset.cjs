const assert = require('node:assert/strict');
const { ethers, network } = require('hardhat');
const E = ethers.parseEther;
const deadline = 2n ** 64n;

async function fixture(decimals = 18, reserve = '10000', ratio = 15000, feedDecimals = 8) {
  const [owner, trader, other] = await ethers.getSigners();
  const settlement = await (await ethers.getContractFactory('MockSettlement')).deploy(decimals);
  const Feed = await ethers.getContractFactory('MockFeed');
  const price = (n) => BigInt(n) * 10n ** BigInt(feedDecimals);
  const assetFeed = await Feed.deploy(feedDecimals, price(100));
  const stableFeed = await Feed.deploy(feedDecimals, price(1));
  const nativeFeed = await Feed.deploy(feedDecimals, price(600));
  const config = (feed) => [feed.target, 3600, E('0.1'), E('1000000')];
  const args = [
    'Reference Asset',
    'rASSET',
    owner.address,
    settlement.target,
    config(assetFeed),
    config(stableFeed),
    config(nativeFeed),
    E('1000000'),
    ratio,
  ];
  const Factory = await ethers.getContractFactory('OracleAsset');
  const asset = await Factory.deploy(...args);
  const unit = 10n ** BigInt(decimals);
  await settlement.mint(trader.address, 100000n * unit);
  await settlement.connect(trader).approve(asset.target, ethers.MaxUint256);
  await settlement.mint(owner.address, BigInt(reserve) * unit);
  await settlement.approve(asset.target, ethers.MaxUint256);
  if (reserve !== '0') await asset.fundReserve(BigInt(reserve) * unit);
  await asset.setTradingEnabled(true);
  return {
    owner,
    trader,
    other,
    settlement,
    asset,
    assetFeed,
    stableFeed,
    nativeFeed,
    unit,
    Factory,
    args,
  };
}

async function rejects(promise, name) {
  await assert.rejects(promise, (error) => {
    assert.match(String(error), new RegExp(name));
    return true;
  });
}
async function now() {
  return BigInt((await ethers.provider.getBlock('latest')).timestamp);
}

describe('OracleAsset', function () {
  for (const decimals of [6, 18]) {
    it(`settles buys and redemptions using ${decimals}-decimal collateral`, async function () {
      const { asset, trader, settlement, unit } = await fixture(decimals);
      assert.equal(await asset.previewBuy(100n * unit), E('1'));
      await asset.connect(trader).buy(100n * unit, E('1'), deadline);
      assert.equal(await asset.balanceOf(trader.address), E('1'));
      const before = await settlement.balanceOf(trader.address);
      await asset.connect(trader).redeem(E('1'), 100n * unit, deadline);
      assert.equal((await settlement.balanceOf(trader.address)) - before, 100n * unit);
      assert.equal(await asset.totalSupply(), 0n);
    });
  }

  it('prices settlement depegs rather than assuming a dollar peg', async function () {
    const { asset, stableFeed, trader, unit } = await fixture();
    await stableFeed.set(50000000, await now());
    assert.equal(await asset.previewBuy(200n * unit), E('1'));
    await asset.connect(trader).buy(200n * unit, E('1'), deadline);
    assert.equal(await asset.previewRedeem(E('1')), 200n * unit);
  });

  it('requires prefunded settlement reserves for native purchases', async function () {
    const { asset, trader } = await fixture(18, '0');
    await rejects(
      asset.connect(trader).buyWithNative(0, deadline, { value: E('1') }),
      'ReserveTooLow',
    );
    assert.equal(await asset.totalSupply(), 0n);
    assert.equal(await ethers.provider.getBalance(asset.target), 0n);
  });

  it('mints against native payment and redeems into settlement tokens', async function () {
    const { asset, trader, settlement, unit } = await fixture();
    assert.equal(await asset.previewBuyWithNative(E('1')), E('6'));
    await asset.connect(trader).buyWithNative(E('6'), deadline, { value: E('1') });
    const before = await settlement.balanceOf(trader.address);
    await asset.connect(trader).redeem(E('6'), 600n * unit, deadline);
    assert.equal((await settlement.balanceOf(trader.address)) - before, 600n * unit);
  });

  it('rolls back stable deposits that would exceed reserve capacity', async function () {
    const { asset, trader, settlement, unit } = await fixture(18, '0');
    const before = await settlement.balanceOf(trader.address);
    await rejects(asset.connect(trader).buy(100n * unit, 0, deadline), 'ReserveTooLow');
    assert.equal(await settlement.balanceOf(trader.address), before);
  });

  it('blocks owner withdrawals below the current buffered liability', async function () {
    const { asset, trader, owner, unit } = await fixture();
    await asset.connect(trader).buy(100n * unit, 0, deadline);
    assert.equal(await asset.requiredReserve(E('1')), 150n * unit);
    await rejects(asset.withdrawSurplus(owner.address, 9951n * unit), 'ReserveTooLow');
    await asset.withdrawSurplus(owner.address, 9950n * unit);
  });

  it('allows redemption below the buffer but rejects payouts larger than liquidity', async function () {
    const { asset, trader, assetFeed, settlement } = await fixture(18, '100');
    await asset.connect(trader).buy(E('100'), 0, deadline);
    await assetFeed.set(19000000000n, await now());
    await asset.connect(trader).redeem(E('0.1'), 0, deadline);
    await assetFeed.set(30000000000n, await now());
    const before = await settlement.balanceOf(asset.target);
    await rejects(asset.connect(trader).redeem(E('0.9'), 0, deadline), 'ReserveTooLow');
    assert.equal(await settlement.balanceOf(asset.target), before);
    assert.equal(await asset.balanceOf(trader.address), E('0.9'));
  });

  for (const feedName of ['assetFeed', 'stableFeed', 'nativeFeed']) {
    it(`rejects stale ${feedName} data`, async function () {
      const f = await fixture();
      await f[feedName].set(100000000, (await now()) - 3601n);
      const quote =
        feedName === 'nativeFeed'
          ? f.asset.previewBuyWithNative(E('1'))
          : f.asset.previewBuy(E('1'));
      await rejects(quote, 'StalePrice');
    });
  }

  for (const [answer, stamp, error] of [
    [0n, 'now', 'InvalidPrice'],
    [-1n, 'now', 'InvalidPrice'],
    [100000000n, 'zero', 'InvalidPrice'],
    [100000000n, 'future', 'InvalidPrice'],
    [1n, 'now', 'InvalidPrice'],
    [100000100000000n, 'now', 'InvalidPrice'],
  ]) {
    it(`rejects invalid oracle answer ${answer} / ${stamp}`, async function () {
      const { asset, assetFeed } = await fixture();
      const timestamp = stamp === 'zero' ? 0n : (await now()) + (stamp === 'future' ? 1000n : 0n);
      await assetFeed.set(answer, timestamp);
      await rejects(asset.previewBuy(E('1')), error);
    });
  }

  it('rejects missing rounds and changed unsupported precision', async function () {
    const { asset, assetFeed } = await fixture();
    await assetFeed.setRound(0);
    await rejects(asset.assetPriceUsd(), 'InvalidPrice');
    await assetFeed.setRound(1);
    await assetFeed.setDecimals(19);
    await rejects(asset.assetPriceUsd(), 'InvalidPrice');
  });

  for (const decimals of [0, 8, 18]) {
    it(`normalizes ${decimals}-decimal oracle answers`, async function () {
      const { asset } = await fixture(18, '10000', 15000, decimals);
      assert.equal(await asset.assetPriceUsd(), E('100'));
    });
  }

  it('enforces deadlines and output floors on all trade paths', async function () {
    const { asset, trader } = await fixture();
    await rejects(asset.connect(trader).buy(E('100'), E('2'), deadline), 'Slippage');
    await rejects(asset.connect(trader).buy(E('100'), 0, 0), 'Expired');
    await rejects(
      asset.connect(trader).buyWithNative(E('7'), deadline, { value: E('1') }),
      'Slippage',
    );
    await rejects(asset.connect(trader).buyWithNative(0, 0, { value: E('1') }), 'Expired');
    await asset.connect(trader).buy(E('100'), 0, deadline);
    await rejects(asset.connect(trader).redeem(E('1'), E('101'), deadline), 'Slippage');
    await rejects(asset.connect(trader).redeem(E('1'), 0, 0), 'Expired');
  });

  it('rejects zero and dust trades', async function () {
    const { asset, trader } = await fixture();
    await rejects(asset.connect(trader).buy(0, 0, deadline), 'ZeroAmount');
    await rejects(asset.connect(trader).buy(1, 0, deadline), 'ZeroAmount');
    await rejects(asset.connect(trader).buyWithNative(0, deadline), 'ZeroAmount');
    await rejects(asset.connect(trader).redeem(0, 0, deadline), 'ZeroAmount');
    await rejects(asset.fundReserve(0), 'ZeroAmount');
  });

  it('enforces the immutable supply cap', async function () {
    const f = await fixture();
    f.args[7] = E('0.5');
    const small = await f.Factory.deploy(...f.args);
    await small.setTradingEnabled(true);
    await f.settlement.connect(f.trader).approve(small.target, E('100'));
    await rejects(small.connect(f.trader).buy(E('100'), 0, deadline), 'SupplyCapExceeded');
  });

  it('pauses trade entry points while keeping ERC20 transfers and funding available', async function () {
    const { asset, trader, other } = await fixture();
    await asset.connect(trader).buy(E('100'), 0, deadline);
    await asset.pause();
    await rejects(asset.connect(trader).buy(E('1'), 0, deadline), 'EnforcedPause');
    await rejects(asset.connect(trader).buyWithNative(0, deadline, { value: 1 }), 'EnforcedPause');
    await rejects(asset.connect(trader).redeem(E('1'), 0, deadline), 'EnforcedPause');
    await asset.connect(trader).transfer(other.address, E('0.1'));
    await asset.connect(trader).fundReserve(E('1'));
    await asset.unpause();
    await asset.connect(trader).redeem(E('0.9'), 0, deadline);
  });

  it('requires explicit market opening and supports closing', async function () {
    const f = await fixture();
    const closed = await f.Factory.deploy(...f.args);
    assert.equal(await closed.tradingEnabled(), false);
    await rejects(closed.connect(f.trader).buy(1, 0, deadline), 'TradingClosed');
    await f.asset.setTradingEnabled(false);
    await rejects(f.asset.connect(f.trader).redeem(1, 0, deadline), 'TradingClosed');
  });

  it('uses two-step ownership and rejects unauthorized administration', async function () {
    const { asset, trader, owner, other } = await fixture();
    for (const action of [
      () => asset.connect(trader).pause(),
      () => asset.connect(trader).unpause(),
      () => asset.connect(trader).setTradingEnabled(false),
      () => asset.connect(trader).withdrawSurplus(trader.address, 1),
      () => asset.connect(trader).withdrawNative(trader.address, 1),
    ]) {
      await rejects(action(), 'OwnableUnauthorizedAccount');
    }
    await rejects(asset.renounceOwnership(), 'OwnershipRequired');
    await asset.transferOwnership(other.address);
    assert.equal(await asset.owner(), owner.address);
    await rejects(asset.connect(trader).acceptOwnership(), 'OwnableUnauthorizedAccount');
    await asset.connect(other).acceptOwnership();
    assert.equal(await asset.owner(), other.address);
  });

  it('rejects fee-on-transfer deposits and payouts atomically', async function () {
    const { asset, trader, settlement } = await fixture();
    await settlement.setFee(true);
    await rejects(asset.connect(trader).buy(E('100'), 0, deadline), 'UnsupportedTransfer');
    await rejects(asset.connect(trader).fundReserve(E('100')), 'UnsupportedTransfer');
    await settlement.setFee(false);
    await asset.connect(trader).buy(E('100'), 0, deadline);
    await settlement.setFee(true);
    await rejects(asset.connect(trader).redeem(E('1'), 0, deadline), 'UnsupportedTransfer');
    assert.equal(await asset.balanceOf(trader.address), E('1'));
  });

  it('rolls back burns when settlement transfer fails', async function () {
    const { asset, trader, settlement } = await fixture();
    await asset.connect(trader).buy(E('100'), 0, deadline);
    await settlement.setFail(true);
    await rejects(asset.connect(trader).redeem(E('1'), 0, deadline), 'transfer failed');
    assert.equal(await asset.balanceOf(trader.address), E('1'));
  });

  it('blocks token callbacks into reserve funding', async function () {
    const { asset, trader, settlement } = await fixture();
    await settlement.setCallback(
      asset.target,
      asset.interface.encodeFunctionData('fundReserve', [1]),
    );
    await asset.connect(trader).buy(E('100'), 0, deadline);
    assert.equal(await settlement.callbackBlocked(), true);
  });

  it('checks withdrawal recipients and handles native transfer failures', async function () {
    const { asset, owner, trader } = await fixture();
    await rejects(asset.withdrawSurplus(ethers.ZeroAddress, 1), 'InvalidRecipient');
    await rejects(asset.withdrawSurplus(asset.target, 1), 'InvalidRecipient');
    await rejects(asset.withdrawSurplus(owner.address, 0), 'ZeroAmount');
    await rejects(asset.withdrawNative(owner.address, 0), 'ZeroAmount');
    await rejects(asset.withdrawNative(ethers.ZeroAddress, 1), 'InvalidRecipient');
    await rejects(asset.withdrawNative(asset.target, 1), 'InvalidRecipient');
    await asset.connect(trader).buyWithNative(0, deadline, { value: E('1') });
    const reject = await (await ethers.getContractFactory('RejectNative')).deploy();
    await rejects(asset.withdrawNative(reject.target, E('1')), 'NativeTransferFailed');
    await asset.withdrawNative(owner.address, E('1'));
    assert.equal(await ethers.provider.getBalance(asset.target), 0n);
    await rejects(owner.sendTransaction({ to: asset.target, value: 1 }), 'revert');
  });

  it('rejects invalid deployment parameters', async function () {
    const f = await fixture();
    for (const [index, value] of [
      [3, ethers.ZeroAddress],
      [7, 0],
      [8, 9999],
      [8, 50001],
      [4, [f.assetFeed.target, 0, 1, E('1')]],
      [4, [f.assetFeed.target, 1, 0, E('1')]],
      [4, [f.assetFeed.target, 1, E('1'), E('1')]],
      [4, [ethers.ZeroAddress, 1, 1, E('1')]],
    ]) {
      const args = [...f.args];
      args[index] = value;
      await rejects(f.Factory.deploy(...args), 'InvalidConfiguration');
    }
    const args = [...f.args];
    args[2] = ethers.ZeroAddress;
    await rejects(f.Factory.deploy(...args), 'OwnableInvalidOwner');
    await f.assetFeed.setDecimals(19);
    await rejects(f.Factory.deploy(...f.args), 'InvalidConfiguration');
    args[2] = f.owner.address;
    args[3] = (await (await ethers.getContractFactory('MockSettlement')).deploy(19)).target;
    await rejects(f.Factory.deploy(...args), 'InvalidConfiguration');
  });

  it('preserves rounding and reserve properties across 80 deterministic trade amounts', async function () {
    const { asset, trader, settlement, unit } = await fixture(6, '100000');
    let seed = 0x51a7n;
    for (let i = 0; i < 80; i++) {
      seed = (seed * 1664525n + 1013904223n) % 2n ** 32n;
      const input = (seed % (1000n * unit)) + 100n;
      const output = await asset.previewBuy(input);
      const refund = await asset.previewRedeem(output);
      assert.ok(refund <= input);
      await asset.connect(trader).buy(input, output, deadline);
      assert.ok(
        (await settlement.balanceOf(asset.target)) >=
          (await asset.requiredReserve(await asset.totalSupply())),
      );
      await asset.connect(trader).redeem(output, refund, deadline);
      assert.equal(await asset.totalSupply(), 0n);
    }
  });
});
