const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("VantexCapital", function () {
  const usdt = (value) => ethers.parseUnits(String(value), 6);
  const DAY = 24 * 60 * 60;

  async function setNextBlockOnWeekday(targetDay) {
    const latest = Number(await time.latest());
    const elapsedDays = Math.floor(latest / DAY);
    const currentDay = (elapsedDays + 4) % 7; // Unix epoch day zero was Thursday.
    const offset = (targetDay - currentDay + 7) % 7;
    let target = (elapsedDays + offset) * DAY;
    if (target <= latest) target += 7 * DAY;
    await time.setNextBlockTimestamp(target);
  }

  async function fixture() {
    const [owner, alice, bob, carol] = await ethers.getSigners();
    const token = await ethers.deployContract("MockUSDT");
    const VantexCapital = await ethers.getContractFactory("VantexCapital");
    const vantex = await upgrades.deployProxy(
      VantexCapital,
      [await token.getAddress(), 6, owner.address],
      { initializer: "initialize", kind: "uups" }
    );
    await vantex.waitForDeployment();
    for (const signer of [owner, alice, bob, carol]) {
      await token.mint(signer.address, usdt(100_000));
      await token.connect(signer).approve(await vantex.getAddress(), ethers.MaxUint256);
    }
    await vantex.fundRewards(usdt(50_000));
    return { owner, alice, bob, carol, token, vantex };
  }

  it("registers both organization legs and prevents slot replacement", async function () {
    const { owner, alice, bob, carol, vantex } = await fixture();
    await expect(vantex.connect(alice).register(owner.address, 0, 0))
      .to.emit(vantex, "Registered").withArgs(alice.address, owner.address, 0, 0);
    await vantex.connect(bob).register(owner.address, 1, 0);
    await expect(vantex.connect(carol).register(owner.address, 0, 1)).to.be.revertedWithCustomError(vantex, "LegOccupied");
  });

  it("stores ROI or auto-compound mode during registration", async function () {
    const { owner, alice, bob, vantex } = await fixture();
    await vantex.connect(alice).registerWithMode(owner.address, 0, 0, 0);
    await vantex.connect(bob).registerWithMode(owner.address, 1, 0, 1);
    expect(await vantex.rewardMode(alice.address)).to.equal(0);
    expect(await vantex.rewardMode(bob.address)).to.equal(1);
  });

  it("allows only the owner to upgrade while preserving registrations and positions", async function () {
    const { owner, alice, vantex } = await fixture();
    await vantex.connect(alice).register(owner.address, 0, 0);
    await vantex.invest(usdt(100), 0);

    const V2 = await ethers.getContractFactory("VantexCapitalV2");
    const currentImplementation = await upgrades.erc1967.getImplementationAddress(await vantex.getAddress());
    await expect(vantex.connect(alice).upgradeToAndCall(currentImplementation, "0x"))
      .to.be.revertedWithCustomError(vantex, "OwnableUnauthorizedAccount")
      .withArgs(alice.address);

    const upgraded = await upgrades.upgradeProxy(await vantex.getAddress(), V2, { kind: "uups" });
    await upgraded.waitForDeployment();
    expect(await upgraded.getAddress()).to.equal(await vantex.getAddress());
    expect(await upgraded.version()).to.equal(2);
    expect((await upgraded.members(alice.address)).registered).to.equal(true);
    expect(await upgraded.positionsOf(owner.address)).to.have.length(1);
    expect(await upgraded.owner()).to.equal(owner.address);
  });

  it("registers, authorizes the token, and creates a position in one transaction", async function () {
    const { owner, alice, token, vantex } = await fixture();
    const amount = usdt(501);
    const deadline = (await time.latest()) + 3600;
    const network = await ethers.provider.getNetwork();
    const signature = await alice.signTypedData(
      {
        name: "Mock USDT",
        version: "1",
        chainId: network.chainId,
        verifyingContract: await token.getAddress()
      },
      {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" }
        ]
      },
      {
        owner: alice.address,
        spender: await vantex.getAddress(),
        value: amount,
        nonce: await token.nonces(alice.address),
        deadline
      }
    );
    const { v, r, s } = ethers.Signature.from(signature);

    await token.connect(alice).approve(await vantex.getAddress(), 0);
    await expect(vantex.connect(alice).registerAndInvestWithPermit(owner.address, 0, 0, amount, 2, deadline, v, r, s))
      .to.emit(vantex, "Registered").withArgs(alice.address, owner.address, 0, 0)
      .and.to.emit(vantex, "Invested");

    expect((await vantex.members(alice.address)).registered).to.equal(true);
    expect(await vantex.positionsOf(alice.address)).to.have.length(1);
    expect(await token.allowance(alice.address, await vantex.getAddress())).to.equal(0);
  });

  it("enforces all four brochure package ranges and rates", async function () {
    const { vantex } = await fixture();
    const package1 = await vantex.planTerms(usdt(100), 0);
    expect(package1[0]).to.equal(100);
    expect(package1[1]).to.equal(200 * DAY);
    const package2 = await vantex.planTerms(usdt(101), 1);
    expect(package2[0]).to.equal(110);
    expect(package2[1]).to.equal(Math.ceil(20_000 * DAY / 110));
    expect((await vantex.planTerms(usdt(500), 1))[0]).to.equal(110);
    const package3 = await vantex.planTerms(usdt(501), 2);
    expect(package3[0]).to.equal(120);
    expect(package3[1]).to.equal(Math.ceil(20_000 * DAY / 120));
    expect((await vantex.planTerms(usdt(1000), 2))[0]).to.equal(120);
    const package4 = await vantex.planTerms(usdt(1001), 3);
    expect(package4[0]).to.equal(130);
    expect(package4[1]).to.equal(Math.ceil(20_000 * DAY / 130));
    expect((await vantex.planTerms(usdt(2500), 3))[0]).to.equal(130);
    await expect(vantex.planTerms(usdt(101), 0)).to.be.revertedWithCustomError(vantex, "InvalidAmount");
    await expect(vantex.planTerms(usdt(500), 2)).to.be.revertedWithCustomError(vantex, "InvalidAmount");
  });

  it("accrues and claims package ROI", async function () {
    const { owner, token, vantex } = await fixture();
    await setNextBlockOnWeekday(1); // Monday UTC
    await vantex.invest(usdt(1000), 2); // package 3: 0.60% daily
    await time.increase(14 * DAY); // Ten Monday-Friday earning days
    expect(await vantex.pendingRoi(owner.address)).to.equal(usdt(120));
    const before = await token.balanceOf(owner.address);
    await expect(vantex.claimRoi()).to.emit(vantex, "RoiClaimed");
    expect(await token.balanceOf(owner.address)).to.be.closeTo(before + usdt(120), 1_000n);
    await time.increase(DAY);
    expect(await vantex.pendingRoi(owner.address)).to.be.closeTo(usdt(12), 1_000n); // still based on $1,000
  });

  it("does not accrue ROI on Saturday or Sunday", async function () {
    const { owner, vantex } = await fixture();
    await setNextBlockOnWeekday(5); // Friday UTC
    await vantex.invest(usdt(1000), 2);
    await time.increase(DAY);
    const fridayAccrual = await vantex.pendingRoi(owner.address);
    expect(fridayAccrual).to.equal(usdt(12));
    await time.increase(2 * DAY);
    expect(await vantex.pendingRoi(owner.address)).to.equal(fridayAccrual);
  });

  it("caps accrual at the plan duration", async function () {
    const { owner, vantex } = await fixture();
    await setNextBlockOnWeekday(1);
    await vantex.invest(usdt(100), 0);
    await time.increase(400 * DAY);
    expect(await vantex.pendingRoi(owner.address)).to.equal(usdt(200)); // 100 × 1% × 200
    const [position] = await vantex.positionsOf(owner.address);
    expect(position.endsAt - position.startedAt).to.equal(BigInt(280 * DAY));
  });

  it("finishes higher-rate packages sooner while capping payout at exactly 2x", async function () {
    const { owner, vantex } = await fixture();
    await setNextBlockOnWeekday(1);
    await vantex.invest(usdt(101), 1);
    const [position] = await vantex.positionsOf(owner.address);
    expect(position.endsAt - position.startedAt).to.be.lessThan(BigInt(280 * DAY));
    await time.increase(300 * DAY);
    expect(await vantex.pendingRoi(owner.address)).to.equal(usdt(202));
  });

  it("has no manual compound function", async function () {
    const { vantex } = await fixture();
    expect(vantex.compoundRoi).to.equal(undefined);
  });

  it("offers selectable Starter, Growth and Elite compound packages", async function () {
    const { vantex } = await fixture();
    const starter = await vantex.compoundTerms(usdt(100), 4);
    const growth = await vantex.compoundTerms(usdt(100), 5);
    const elite = await vantex.compoundTerms(usdt(100), 6);
    expect(starter).to.deep.equal([60n, BigInt(90 * DAY)]);
    expect(growth).to.deep.equal([65n, BigInt(150 * DAY)]);
    expect(elite).to.deep.equal([70n, BigInt(200 * DAY)]);
  });

  it("accrues compound profit continuously while principal remains locked", async function () {
    const { owner, token, vantex } = await fixture();
    await vantex.setRewardMode(1);
    await setNextBlockOnWeekday(1); // Monday 00:00 UTC
    await vantex.invest(usdt(1000), 4); // Starter: $6 profit per earning day
    await time.increase(1);
    expect(await vantex.pendingRoi(owner.address)).to.be.greaterThan(0);
    expect(await vantex.pendingRoi(owner.address)).to.be.lessThan(usdt(0.001));
    const before = await token.balanceOf(owner.address);
    await vantex.claimRoi(); // compound claims do not wait for the $5 ROI minimum
    expect(await token.balanceOf(owner.address)).to.be.greaterThan(before);
    expect((await vantex.positionsOf(owner.address))[0].principal).to.equal(usdt(1000));
  });

  it("does not accrue compound profit on Saturday or Sunday", async function () {
    const { owner, vantex } = await fixture();
    await vantex.setRewardMode(1);
    await setNextBlockOnWeekday(5); // Friday 00:00 UTC
    await vantex.invest(usdt(1000), 4);
    await time.increase(3 * DAY); // Monday: only Friday has closed on an earning day
    expect(await vantex.pendingRoi(owner.address)).to.be.closeTo(usdt(6), 10n);
    await time.increase(DAY); // Tuesday: Monday closed too
    expect(await vantex.pendingRoi(owner.address)).to.be.closeTo(usdt(12), 10n);
  });

  it("allows compound profit below $5 to be withdrawn", async function () {
    const { owner, alice, token, vantex } = await fixture();
    await vantex.connect(alice).registerWithMode(owner.address, 0, 0, 1); // Auto Compound
    await setNextBlockOnWeekday(1);
    await vantex.connect(alice).invest(usdt(60), 4); // $0.36 per earning day
    await time.increase(DAY);
    const before = await token.balanceOf(alice.address);
    await expect(vantex.connect(alice).claimRoi()).to.emit(vantex, "RoiClaimed");
    expect(await token.balanceOf(alice.address)).to.be.closeTo(before + usdt(0.36), 100n);
  });

  it("uses 50/50 business to unlock salary cycles", async function () {
    const { owner, alice, bob, token, vantex } = await fixture();
    await vantex.connect(alice).register(owner.address, 0, 0);
    await vantex.connect(bob).register(owner.address, 1, 0);
    await vantex.connect(alice).invest(usdt(500), 1);
    await vantex.connect(bob).invest(usdt(500), 1);
    expect(await vantex.balancedBusiness(owner.address)).to.equal(usdt(1000));
    expect(await vantex.qualifiedLevel(owner.address)).to.equal(7);
    expect((await vantex.members(owner.address)).salaryRank).to.equal(1);
    await time.increase(15 * 24 * 60 * 60);
    const before = await token.balanceOf(owner.address);
    await vantex.claimSalary();
    expect(await token.balanceOf(owner.address)).to.equal(before + usdt(25));
  });

  it("pays qualified ROI-on-ROI referral rewards", async function () {
    const { owner, alice, bob, token, vantex } = await fixture();
    await vantex.invest(usdt(100), 0); // opens $300 of ROI-on-ROI earning capacity
    await vantex.connect(alice).register(owner.address, 0, 0);
    await vantex.connect(bob).register(owner.address, 1, 0);
    await setNextBlockOnWeekday(1);
    await vantex.connect(alice).invest(usdt(600), 2);
    await vantex.connect(bob).invest(usdt(400), 1);
    await time.increase(14 * DAY);
    const before = await token.balanceOf(owner.address);
    await expect(vantex.connect(alice).claimRoi()).to.emit(vantex, "ReferralPaid");
    // Alice receives $72 total ($36 profit + $36 capital); sponsor gets 10% of profit = $3.60.
    expect(await token.balanceOf(owner.address)).to.be.closeTo(before + usdt(3.6), 100n);
    expect(await vantex.referralEarnings(owner.address)).to.be.closeTo(usdt(3.6), 100n);
  });

  it("caps ROI-mode level income at 3x and adds capacity after a new investment", async function () {
    const { owner, alice, bob, vantex } = await fixture();
    await vantex.invest(usdt(1), 0); // $3 level-income capacity
    await vantex.connect(alice).register(owner.address, 0, 0);
    await vantex.connect(bob).register(owner.address, 1, 0);
    await setNextBlockOnWeekday(1);
    await vantex.connect(alice).invest(usdt(2500), 3);
    await vantex.connect(bob).invest(usdt(50), 0); // $100 balanced business opens levels 1-3
    await time.increase(2 * DAY);
    await vantex.connect(alice).claimRoi();
    expect(await vantex.referralEarnings(owner.address)).to.equal(usdt(3));

    await vantex.invest(usdt(1), 0); // another $3 capacity
    await time.increase(2 * DAY);
    await vantex.connect(alice).claimRoi();
    expect(await vantex.referralEarnings(owner.address)).to.equal(usdt(6));
  });

  it("stores the exact 15 ROI-on-ROI percentages", async function () {
    const { vantex } = await fixture();
    const expected = [1000n, 500n, 400n, 300n, 300n, 300n, 200n, 200n, 100n, 100n, 200n, 200n, 300n, 400n, 500n];
    for (let level = 0; level < expected.length; level += 1) {
      expect(await vantex.referralRateBps(level)).to.equal(expected[level]);
    }
  });

  it("unlocks levels with equal leg volume even when the contributor counts differ", async function () {
    const { owner, alice, bob, carol, vantex } = await fixture();
    await vantex.connect(alice).register(owner.address, 0, 0);
    await vantex.connect(bob).register(owner.address, 1, 0);
    await vantex.connect(carol).register(bob.address, 0, 1);

    // One person supplies A's $50; two people collectively supply B's $50.
    await vantex.connect(alice).invest(usdt(50), 0);
    await vantex.connect(bob).invest(usdt(25), 0);
    await vantex.connect(carol).invest(usdt(25), 0);
    expect(await vantex.balancedBusiness(owner.address)).to.equal(usdt(100));
    expect(await vantex.qualifiedLevel(owner.address)).to.equal(3);

    // Levels 4-7 require another $300, making $400 cumulative ($200 per organization).
    await vantex.connect(alice).invest(usdt(150), 1);
    await vantex.connect(bob).invest(usdt(75), 0);
    await vantex.connect(carol).invest(usdt(75), 0);
    expect(await vantex.balancedBusiness(owner.address)).to.equal(usdt(400));
    expect(await vantex.qualifiedLevel(owner.address)).to.equal(7);

    // Levels 8-11 require another $800, making $1,200 cumulative ($600 per organization).
    await vantex.connect(alice).invest(usdt(400), 1);
    await vantex.connect(bob).invest(usdt(200), 1);
    await vantex.connect(carol).invest(usdt(200), 1);
    expect(await vantex.balancedBusiness(owner.address)).to.equal(usdt(1200));
    expect(await vantex.qualifiedLevel(owner.address)).to.equal(11);

    // Levels 12-15 require another $1,500, making $2,700 cumulative ($1,350 per organization).
    await vantex.connect(alice).invest(usdt(750), 2);
    await vantex.connect(bob).invest(usdt(375), 1);
    await vantex.connect(carol).invest(usdt(375), 1);
    expect(await vantex.balancedBusiness(owner.address)).to.equal(usdt(2700));
    expect(await vantex.qualifiedLevel(owner.address)).to.equal(15);
  });

  it("enforces deposit limits and pause controls", async function () {
    const { owner, vantex } = await fixture();
    await expect(vantex.invest(999_999, 0)).to.be.revertedWithCustomError(vantex, "InvalidAmount");
    await vantex.setPaused(true);
    await expect(vantex.invest(usdt(100), 0)).to.be.revertedWithCustomError(vantex, "Paused");
    await expect(vantex.connect(owner).setPaused(false)).to.emit(vantex, "PauseSet").withArgs(false);
  });

  it("credits the placement parent as sponsor for the original register functions", async function () {
    const { owner, alice, bob, vantex } = await fixture();
    await expect(vantex.connect(alice).registerWithMode(owner.address, 0, 0, 0))
      .to.emit(vantex, "Sponsored").withArgs(alice.address, owner.address);
    await vantex.connect(bob).register(owner.address, 1, 0);

    expect(await vantex.sponsorOf(alice.address)).to.equal(owner.address);
    expect(await vantex.directReferralCount(owner.address)).to.equal(2);
    expect(await vantex.directReferralsOf(owner.address, 0, 10)).to.deep.equal([alice.address, bob.address]);
  });

  it("records the inviting sponsor separately from the spillover placement", async function () {
    const { owner, alice, bob, carol, vantex } = await fixture();
    // Owner's two direct spots fill up, so carol (invited by owner) spills over under alice.
    await vantex.connect(alice).registerWithMode(owner.address, 0, 0, 0);
    await vantex.connect(bob).registerWithMode(owner.address, 1, 0, 0);
    await expect(vantex.connect(carol).registerWithSponsor(owner.address, alice.address, 0, 0, 1))
      .to.emit(vantex, "Sponsored").withArgs(carol.address, owner.address);

    expect((await vantex.members(carol.address)).referrer).to.equal(alice.address);
    expect(await vantex.directLeg(alice.address, 0)).to.equal(carol.address);
    expect(await vantex.sponsorOf(carol.address)).to.equal(owner.address);
    expect(await vantex.rewardMode(carol.address)).to.equal(1);
    expect(await vantex.directReferralCount(owner.address)).to.equal(3);
    expect(await vantex.directReferralCount(alice.address)).to.equal(0);
    expect(await vantex.directReferralsOf(owner.address, 2, 10)).to.deep.equal([carol.address]);
    expect(await vantex.directReferralsOf(owner.address, 5, 10)).to.deep.equal([]);
  });

  it("defaults the sponsor to the placement parent and rejects sponsors outside the upline", async function () {
    const { owner, alice, bob, carol, vantex } = await fixture();
    const [, , , , dave] = await ethers.getSigners();
    await vantex.connect(alice).registerWithMode(owner.address, 0, 0, 0);
    await vantex.connect(bob).registerWithMode(owner.address, 1, 0, 0);

    // bob is not above alice, so he cannot be credited for a member placed under alice.
    await expect(vantex.connect(carol).registerWithSponsor(bob.address, alice.address, 0, 0, 0))
      .to.be.revertedWithCustomError(vantex, "InvalidSponsor");
    // An unregistered sponsor is rejected too.
    await expect(vantex.connect(carol).registerWithSponsor(dave.address, alice.address, 0, 0, 0))
      .to.be.revertedWithCustomError(vantex, "InvalidSponsor");
    // address(0) credits the placement parent.
    await vantex.connect(carol).registerWithSponsor(ethers.ZeroAddress, alice.address, 0, 0, 0);
    expect(await vantex.sponsorOf(carol.address)).to.equal(alice.address);
    expect(await vantex.directReferralsOf(alice.address, 0, 10)).to.deep.equal([carol.address]);
  });

  it("registers with a sponsor and invests with a permit in one transaction", async function () {
    const { owner, alice, bob, token, vantex } = await fixture();
    await vantex.connect(alice).registerWithMode(owner.address, 0, 0, 0);
    const amount = usdt(1_200);
    const deadline = (await time.latest()) + 3600;
    const network = await ethers.provider.getNetwork();
    const signature = await bob.signTypedData(
      { name: "Mock USDT", version: "1", chainId: network.chainId, verifyingContract: await token.getAddress() },
      { Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" }
      ] },
      { owner: bob.address, spender: await vantex.getAddress(), value: amount, nonce: await token.nonces(bob.address), deadline }
    );
    const { v, r, s } = ethers.Signature.from(signature);
    await token.connect(bob).approve(await vantex.getAddress(), 0);

    await expect(vantex.connect(bob).registerAndInvestWithSponsor(owner.address, alice.address, 0, 0, 0, amount, 3, { deadline, v, r, s }))
      .to.emit(vantex, "Sponsored").withArgs(bob.address, owner.address)
      .and.to.emit(vantex, "Invested");
    expect(await vantex.sponsorOf(bob.address)).to.equal(owner.address);
    expect((await vantex.members(bob.address)).referrer).to.equal(alice.address);
    expect(await vantex.positionsOf(bob.address)).to.have.length(1);
  });

  it("records ROI-on-ROI history with level, time and per-level totals", async function () {
    const { owner, alice, bob, carol, vantex } = await fixture();
    await vantex.invest(usdt(100), 0); // opens $300 of ROI-on-ROI earning capacity
    await vantex.connect(alice).register(owner.address, 0, 0);
    await vantex.connect(bob).register(owner.address, 1, 0);
    await vantex.connect(carol).register(alice.address, 0, 0);
    await setNextBlockOnWeekday(1);
    await vantex.connect(alice).invest(usdt(600), 2);
    await vantex.connect(bob).invest(usdt(400), 1);
    await vantex.connect(carol).invest(usdt(1000), 2);
    await time.increase(14 * DAY);

    await vantex.connect(alice).claimRoi();
    await vantex.connect(carol).claimRoi();
    const paidAt = await time.latest();

    // Owner: level 1 from alice, then level 2 from carol (owner has unlocked level 11).
    expect(await vantex.referralPaymentCount(owner.address)).to.equal(2);
    const history = await vantex.referralPaymentsOf(owner.address, 0, 10);
    expect(history[0].level).to.equal(1);
    expect(history[0].source).to.equal(alice.address);
    expect(history[1].level).to.equal(2);
    expect(history[1].source).to.equal(carol.address);
    expect(history[1].paidAt).to.equal(paidAt);
    expect(await vantex.referralPaymentsOf(owner.address, 1, 10)).to.have.length(1);
    expect(await vantex.referralPaymentsOf(owner.address, 9, 10)).to.have.length(0);

    const levels = await vantex.referralEarningsByLevel(owner.address);
    expect(levels[0].total).to.equal(history[0].amount);
    expect(levels[0].payments).to.equal(1);
    expect(levels[1].total).to.equal(history[1].amount);
    expect(levels[1].lastPaidAt).to.equal(paidAt);
    expect(levels[2].payments).to.equal(0);
    expect(levels[0].total + levels[1].total).to.equal(await vantex.referralEarnings(owner.address));
  });

  it("requires at least 5 USDT to claim ROI to the wallet", async function () {
    const { owner, vantex } = await fixture();
    expect(await vantex.MIN_CLAIM_USD()).to.equal(5);
    await setNextBlockOnWeekday(1); // Monday UTC
    await vantex.invest(usdt(100), 0); // package 1: $1.00 per earning day
    await time.increase(4 * DAY); // four earning days = $4
    await expect(vantex.claimRoi()).to.be.revertedWithCustomError(vantex, "BelowMinimumClaim").withArgs(usdt(5));
    await time.increase(DAY); // Friday counts too: $5
    await expect(vantex.claimRoi()).to.emit(vantex, "RoiClaimed");
  });

  it("returns compound principal only when the selected term ends", async function () {
    const { owner, token, vantex } = await fixture();
    await vantex.setRewardMode(1);
    await setNextBlockOnWeekday(1);
    await vantex.invest(usdt(1000), 4); // Starter: 0.60% for 90 earning days
    await time.increase(14 * DAY); // ten earning days: $60 profit, no principal
    expect(await vantex.pendingRoi(owner.address)).to.be.closeTo(usdt(60), 100n);

    const before = await token.balanceOf(owner.address);
    await expect(vantex.claimRoi()).to.emit(vantex, "RoiClaimed");
    expect(await token.balanceOf(owner.address)).to.be.closeTo(before + usdt(60), 1_000n);
    expect(await vantex.pendingRoi(owner.address)).to.be.lessThan(usdt(0.01));

    await time.increase(200 * DAY); // beyond 90 earning days
    // Remaining $480 profit plus the locked $1,000 principal.
    expect(await vantex.pendingRoi(owner.address)).to.be.closeTo(usdt(1480), 1_000n);
  });
});
