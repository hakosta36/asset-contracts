// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from '@openzeppelin/contracts/token/ERC20/ERC20.sol';

contract MockFeed {
    uint8 public decimals;
    int256 public answer;
    uint256 public updatedAt;
    uint80 public roundId = 1;
    constructor(uint8 decimals_, int256 answer_) {
        decimals = decimals_;
        set(answer_, block.timestamp);
    }
    function set(int256 answer_, uint256 timestamp) public {
        answer = answer_;
        updatedAt = timestamp;
    }
    function setRound(uint80 round_) external {
        roundId = round_;
    }
    function setDecimals(uint8 decimals_) external {
        decimals = decimals_;
    }
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, updatedAt, updatedAt, roundId);
    }
}

contract MockSettlement is ERC20 {
    uint8 private immutable precision;
    bool public chargeFee;
    bool public failTransfer;
    address public callback;
    bytes public callbackData;
    bool public callbackBlocked;
    constructor(uint8 decimals_) ERC20('Test Settlement', 'TUSD') {
        precision = decimals_;
    }
    function decimals() public view override returns (uint8) {
        return precision;
    }
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
    function setFee(bool enabled) external {
        chargeFee = enabled;
    }
    function setFail(bool enabled) external {
        failTransfer = enabled;
    }
    function setCallback(address target, bytes calldata data) external {
        callback = target;
        callbackData = data;
    }
    function _update(address from, address to, uint256 amount) internal override {
        require(!failTransfer, 'transfer failed');
        if (from != address(0) && to != address(0)) {
            if (callback != address(0)) {
                (bool ok, ) = callback.call(callbackData);
                callbackBlocked = !ok;
            }
            if (chargeFee) {
                super._update(from, address(0), amount / 100);
                amount -= amount / 100;
            }
        }
        super._update(from, to, amount);
    }
}

contract RejectNative {
    receive() external payable {
        revert();
    }
}
