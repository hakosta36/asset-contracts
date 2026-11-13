// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {IERC20Metadata} from '@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';
import {Ownable2Step} from '@openzeppelin/contracts/access/Ownable2Step.sol';
import {Pausable} from '@openzeppelin/contracts/utils/Pausable.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {Math} from '@openzeppelin/contracts/utils/math/Math.sol';
import {IAggregatorV3} from './interfaces/IAggregatorV3.sol';

/// @notice Oracle-priced synthetic exposure, redeemable from a funded settlement reserve.
/// @dev A reserve buffer is an admission control, not a hedge against future price moves.
contract OracleAsset is ERC20, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct FeedConfig {
        address feed;
        uint32 maxAge;
        uint256 minPrice;
        uint256 maxPrice;
    }

    IERC20 public immutable settlementToken;
    uint256 public immutable settlementUnit;
    uint256 public immutable supplyCap;
    uint256 public immutable reserveRatioBps;
    FeedConfig public assetFeed;
    FeedConfig public settlementFeed;
    FeedConfig public nativeFeed;
    bool public tradingEnabled;

    error InvalidConfiguration();
    error InvalidPrice(address feed);
    error StalePrice(address feed);
    error ZeroAmount();
    error Expired();
    error Slippage(uint256 output, uint256 minimum);
    error TradingClosed();
    error SupplyCapExceeded();
    error ReserveTooLow(uint256 available, uint256 required);
    error UnsupportedTransfer();
    error InvalidRecipient();
    error NativeTransferFailed();
    error OwnershipRequired();

    event Purchased(
        address indexed account,
        address indexed paymentToken,
        uint256 input,
        uint256 output
    );
    event Redeemed(address indexed account, uint256 input, uint256 output);
    event ReserveFunded(address indexed account, uint256 amount);
    event ReserveWithdrawn(address indexed recipient, uint256 amount);
    event NativeWithdrawn(address indexed recipient, uint256 amount);
    event TradingEnabled(bool enabled);

    constructor(
        string memory name_,
        string memory symbol_,
        address owner_,
        address settlement_,
        FeedConfig memory asset_,
        FeedConfig memory settlementUsd_,
        FeedConfig memory native_,
        uint256 cap_,
        uint256 ratioBps_
    ) ERC20(name_, symbol_) Ownable(owner_) {
        if (settlement_.code.length == 0 || cap_ == 0 || ratioBps_ < 10_000 || ratioBps_ > 50_000)
            revert InvalidConfiguration();
        uint8 decimals_ = IERC20Metadata(settlement_).decimals();
        if (decimals_ > 18) revert InvalidConfiguration();
        _validateFeed(asset_);
        _validateFeed(settlementUsd_);
        _validateFeed(native_);
        settlementToken = IERC20(settlement_);
        settlementUnit = 10 ** decimals_;
        supplyCap = cap_;
        reserveRatioBps = ratioBps_;
        assetFeed = asset_;
        settlementFeed = settlementUsd_;
        nativeFeed = native_;
    }

    function assetPriceUsd() public view returns (uint256) {
        return _price(assetFeed);
    }
    function settlementPriceUsd() public view returns (uint256) {
        return _price(settlementFeed);
    }
    function nativePriceUsd() public view returns (uint256) {
        return _price(nativeFeed);
    }

    function previewBuy(uint256 amount) public view returns (uint256) {
        uint256 usdValue = Math.mulDiv(amount, settlementPriceUsd(), settlementUnit);
        return Math.mulDiv(usdValue, 1e18, assetPriceUsd());
    }

    function previewBuyWithNative(uint256 amount) public view returns (uint256) {
        return Math.mulDiv(amount, nativePriceUsd(), assetPriceUsd());
    }

    function previewRedeem(uint256 amount) public view returns (uint256) {
        uint256 usdValue = Math.mulDiv(amount, assetPriceUsd(), 1e18);
        return Math.mulDiv(usdValue, settlementUnit, settlementPriceUsd());
    }

    /// @notice Settlement units needed at current prices, rounded up at every step.
    function requiredReserve(uint256 supply) public view returns (uint256) {
        uint256 usdValue = Math.mulDiv(supply, assetPriceUsd(), 1e18, Math.Rounding.Ceil);
        uint256 liability = Math.mulDiv(
            usdValue,
            settlementUnit,
            settlementPriceUsd(),
            Math.Rounding.Ceil
        );
        return Math.mulDiv(liability, reserveRatioBps, 10_000, Math.Rounding.Ceil);
    }

    function buy(
        uint256 amount,
        uint256 minOut,
        uint256 deadline
    ) external nonReentrant whenNotPaused returns (uint256 output) {
        _checkTrade(amount, deadline);
        output = previewBuy(amount);
        _checkOutput(output, minOut);
        _pull(amount);
        _issue(output);
        emit Purchased(msg.sender, address(settlementToken), amount, output);
    }

    function buyWithNative(
        uint256 minOut,
        uint256 deadline
    ) external payable nonReentrant whenNotPaused returns (uint256 output) {
        _checkTrade(msg.value, deadline);
        output = previewBuyWithNative(msg.value);
        _checkOutput(output, minOut);
        // Native proceeds are treasury assets; only settlement tokens cover redemptions.
        _issue(output);
        emit Purchased(msg.sender, address(0), msg.value, output);
    }

    function redeem(
        uint256 amount,
        uint256 minOut,
        uint256 deadline
    ) external nonReentrant whenNotPaused returns (uint256 output) {
        _checkTrade(amount, deadline);
        output = previewRedeem(amount);
        _checkOutput(output, minOut);
        uint256 available = settlementToken.balanceOf(address(this));
        if (output > available) revert ReserveTooLow(available, output);
        _burn(msg.sender, amount);
        _push(msg.sender, output);
        emit Redeemed(msg.sender, amount, output);
    }

    function fundReserve(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _pull(amount);
        emit ReserveFunded(msg.sender, amount);
    }

    function withdrawSurplus(address recipient, uint256 amount) external onlyOwner nonReentrant {
        _checkRecipient(recipient);
        if (amount == 0) revert ZeroAmount();
        uint256 available = settlementToken.balanceOf(address(this));
        uint256 required = requiredReserve(totalSupply());
        if (amount > available || available - amount < required)
            revert ReserveTooLow(available, required);
        _push(recipient, amount);
        emit ReserveWithdrawn(recipient, amount);
    }

    function withdrawNative(
        address payable recipient,
        uint256 amount
    ) external onlyOwner nonReentrant {
        _checkRecipient(recipient);
        if (amount == 0) revert ZeroAmount();
        (bool ok, ) = recipient.call{value: amount}('');
        if (!ok) revert NativeTransferFailed();
        emit NativeWithdrawn(recipient, amount);
    }

    /// @dev Closed by default; operators must open only within the underlying market's session.
    function setTradingEnabled(bool enabled) external onlyOwner {
        tradingEnabled = enabled;
        emit TradingEnabled(enabled);
    }

    function pause() external onlyOwner {
        _pause();
    }
    function unpause() external onlyOwner {
        _unpause();
    }

    function renounceOwnership() public view override onlyOwner {
        revert OwnershipRequired();
    }

    function _issue(uint256 amount) private {
        uint256 supply = totalSupply() + amount;
        if (supply > supplyCap) revert SupplyCapExceeded();
        uint256 available = settlementToken.balanceOf(address(this));
        uint256 required = requiredReserve(supply);
        if (available < required) revert ReserveTooLow(available, required);
        _mint(msg.sender, amount);
    }

    function _checkTrade(uint256 amount, uint256 deadline) private view {
        if (!tradingEnabled) revert TradingClosed();
        if (block.timestamp > deadline) revert Expired();
        if (amount == 0) revert ZeroAmount();
    }

    function _checkOutput(uint256 output, uint256 minimum) private pure {
        if (output == 0) revert ZeroAmount();
        if (output < minimum) revert Slippage(output, minimum);
    }

    function _checkRecipient(address recipient) private view {
        if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient();
    }

    function _pull(uint256 amount) private {
        uint256 beforeBalance = settlementToken.balanceOf(address(this));
        settlementToken.safeTransferFrom(msg.sender, address(this), amount);
        if (settlementToken.balanceOf(address(this)) != beforeBalance + amount)
            revert UnsupportedTransfer();
    }

    function _push(address recipient, uint256 amount) private {
        uint256 beforeReserve = settlementToken.balanceOf(address(this));
        uint256 beforeRecipient = settlementToken.balanceOf(recipient);
        settlementToken.safeTransfer(recipient, amount);
        if (
            settlementToken.balanceOf(address(this)) != beforeReserve - amount ||
            settlementToken.balanceOf(recipient) != beforeRecipient + amount
        ) revert UnsupportedTransfer();
    }

    function _validateFeed(FeedConfig memory config) private view {
        if (
            config.feed.code.length == 0 ||
            config.maxAge == 0 ||
            config.minPrice == 0 ||
            config.maxPrice <= config.minPrice ||
            IAggregatorV3(config.feed).decimals() > 18
        ) revert InvalidConfiguration();
    }

    function _price(FeedConfig memory config) private view returns (uint256 price) {
        IAggregatorV3 feed = IAggregatorV3(config.feed);
        (uint80 round, int256 answer, , uint256 updatedAt, ) = feed.latestRoundData();
        if (round == 0 || answer <= 0 || updatedAt == 0 || updatedAt > block.timestamp)
            revert InvalidPrice(config.feed);
        if (block.timestamp - updatedAt > config.maxAge) revert StalePrice(config.feed);
        uint8 decimals_ = feed.decimals();
        if (decimals_ > 18) revert InvalidPrice(config.feed);
        price = Math.mulDiv(uint256(answer), 10 ** (18 - decimals_), 1);
        if (price < config.minPrice || price > config.maxPrice) revert InvalidPrice(config.feed);
    }
}
