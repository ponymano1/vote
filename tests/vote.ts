import * as anchor from "@coral-xyz/anchor";
import { AnchorError, BN, Program } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import { Vote } from "../target/types/vote";

const PROGRAM_ID = new PublicKey(
  "71DneA16fd9TThE6k1ziJbhYBjyYTppBk2HTDLMJffxC",
);

function pollAddress(pollId: BN): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("poll"), pollId.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID,
  )[0];
}

function candidateAddress(pollId: BN, candidate: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [pollId.toArrayLike(Buffer, "le", 8), Buffer.from(candidate)],
    PROGRAM_ID,
  )[0];
}

function voteRecordAddress(pollId: BN, voter: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("vote_record"),
      pollId.toArrayLike(Buffer, "le", 8),
      voter.toBuffer(),
    ],
    PROGRAM_ID,
  )[0];
}

async function expectVoteToFail(
  promise: Promise<string>,
  messagePattern = /already in use|custom program error|0x0/i,
) {
  let failed = false;
  try {
    await promise;
  } catch (err) {
    failed = true;
    const message = err instanceof Error ? err.message : String(err);
    expect(message).to.match(messagePattern);
  }
  expect(failed).to.equal(true);
}

async function airdrop(
  connection: anchor.web3.Connection,
  pubkey: PublicKey,
  lamports = 2 * LAMPORTS_PER_SOL,
) {
  const sig = await connection.requestAirdrop(pubkey, lamports);
  await connection.confirmTransaction(sig);
}

describe("vote", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.vote as Program<Vote>;
  const provider = anchor.getProvider();

  const POLL_ID = new BN(1);
  const pollAddressForPoll1 = pollAddress(POLL_ID);

  it("initializeds a poll", async () => {
    await program.methods
      .initializePoll(
        POLL_ID,
        new BN(0),
        new BN(1893456000),
        "Test Poll",
        "Test Description: A poll to test the vote program",
      )
      .rpc();

    const pollAccount = await program.account.pollAccount.fetch(
      pollAddressForPoll1,
    );
    console.log("Poll Account:", pollAccount);

    expect(pollAccount.pollName).to.equal("Test Poll");
    expect(pollAccount.pollDescription).to.equal(
      "Test Description: A poll to test the vote program",
    );
    expect(pollAccount.pollVotingStart.toNumber()).to.equal(
      new BN(0).toNumber(),
    );
    expect(pollAccount.pollVotingEnd.toNumber()).to.equal(
      new BN(1893456000).toNumber(),
    );
    expect(pollAccount.pollOptionIndex.toNumber()).to.equal(0);
  });

  it("initializes a candidate", async () => {
    await program.methods.initializeCandidate(POLL_ID, "Alice").rpc();
    await program.methods.initializeCandidate(POLL_ID, "Bob").rpc();

    const pollAccount = await program.account.pollAccount.fetch(
      pollAddressForPoll1,
    );
    console.log("Poll Account:", pollAccount);

    expect(pollAccount.pollOptionIndex.toNumber()).to.equal(2);
  });

  it("votes for a candidate", async () => {
    const aliceAddress = candidateAddress(POLL_ID, "Alice");

    await program.methods.vote(POLL_ID, "Alice").rpc();

    const candidateAccount = await program.account.candidateAccount.fetch(
      aliceAddress,
    );
    console.log("Candidate Account:", candidateAccount);

    expect(candidateAccount.candidateVotes.toNumber()).to.equal(1);
  });

  describe("one vote per user per poll", () => {
    const VOTE_POLL_ID = new BN(200);
    const OTHER_POLL_ID = new BN(201);
    const voter = Keypair.generate();

    before(async () => {
      await airdrop(provider.connection, voter.publicKey);

      for (const pollId of [VOTE_POLL_ID, OTHER_POLL_ID]) {
        await program.methods
          .initializePoll(
            pollId,
            new BN(0),
            new BN(1893456000),
            `Poll ${pollId.toString()}`,
            "One vote per user test poll",
          )
          .rpc();

        await program.methods.initializeCandidate(pollId, "Alice").rpc();
        await program.methods.initializeCandidate(pollId, "Bob").rpc();
      }
    });

    it("creates a vote record on the first vote", async () => {
      const aliceAddress = candidateAddress(VOTE_POLL_ID, "Alice");
      const recordAddress = voteRecordAddress(VOTE_POLL_ID, voter.publicKey);

      await program.methods
        .vote(VOTE_POLL_ID, "Alice")
        .accountsPartial({
          signer: voter.publicKey,
        })
        .signers([voter])
        .rpc();

      const candidateAccount =
        await program.account.candidateAccount.fetch(aliceAddress);
      const voteRecord = await program.account.voteRecord.fetch(recordAddress);

      expect(candidateAccount.candidateVotes.toNumber()).to.equal(1);
      expect(voteRecord).to.not.be.null;
    });

    it("rejects a second vote from the same user in the same poll", async () => {
      const aliceAddress = candidateAddress(VOTE_POLL_ID, "Alice");
      const bobAddress = candidateAddress(VOTE_POLL_ID, "Bob");

      await expectVoteToFail(
        program.methods
          .vote(VOTE_POLL_ID, "Bob")
          .accountsPartial({
            signer: voter.publicKey,
          })
          .signers([voter])
          .rpc(),
      );

      const aliceAccount =
        await program.account.candidateAccount.fetch(aliceAddress);
      const bobAccount = await program.account.candidateAccount.fetch(bobAddress);

      expect(aliceAccount.candidateVotes.toNumber()).to.equal(1);
      expect(bobAccount.candidateVotes.toNumber()).to.equal(0);
    });

    it("allows a different user to vote in the same poll", async () => {
      const otherVoter = Keypair.generate();
      await airdrop(provider.connection, otherVoter.publicKey);

      const bobAddress = candidateAddress(VOTE_POLL_ID, "Bob");

      await program.methods
        .vote(VOTE_POLL_ID, "Bob")
        .accountsPartial({
          signer: otherVoter.publicKey,
        })
        .signers([otherVoter])
        .rpc();

      const bobAccount = await program.account.candidateAccount.fetch(bobAddress);
      expect(bobAccount.candidateVotes.toNumber()).to.equal(1);
    });

    it("allows the same user to vote in a different poll", async () => {
      const aliceAddress = candidateAddress(OTHER_POLL_ID, "Alice");

      await program.methods
        .vote(OTHER_POLL_ID, "Alice")
        .accountsPartial({
          signer: voter.publicKey,
        })
        .signers([voter])
        .rpc();

      const aliceAccount =
        await program.account.candidateAccount.fetch(aliceAddress);
      expect(aliceAccount.candidateVotes.toNumber()).to.equal(1);
    });
  });

  describe("access control", () => {
    const PERM_POLL_ID = new BN(100);
    const permPollAddress = pollAddress(PERM_POLL_ID);
    const attacker = Keypair.generate();

    before(async () => {
      await airdrop(provider.connection, attacker.publicKey);

      await program.methods
        .initializePoll(
          PERM_POLL_ID,
          new BN(0),
          new BN(1893456000),
          "Permission Poll",
          "Poll for access control tests",
        )
        .rpc();
    });

    it("stores the poll creator on initialization", async () => {
      const pollAccount = await program.account.pollAccount.fetch(
        permPollAddress,
      );

      expect(pollAccount.creator.toBase58()).to.equal(
        provider.wallet.publicKey.toBase58(),
      );
    });

    it("rejects candidate initialization from a non-creator", async () => {
      try {
        await program.methods
          .initializeCandidate(PERM_POLL_ID, "AttackerCandidate")
          .accounts({
            signer: attacker.publicKey,
          })
          .signers([attacker])
          .rpc();
        expect.fail("Expected Unauthorized error");
      } catch (err) {
        expect(err).to.be.instanceOf(AnchorError);
        expect((err as AnchorError).error.errorCode.code).to.equal(
          "Unauthorized",
        );
      }
    });

    it("allows the poll creator to initialize a candidate", async () => {
      const charlieAddress = candidateAddress(PERM_POLL_ID, "Charlie");

      await program.methods.initializeCandidate(PERM_POLL_ID, "Charlie").rpc();

      const candidateAccount = await program.account.candidateAccount.fetch(
        charlieAddress,
      );

      expect(candidateAccount.candidateName).to.equal("Charlie");
      expect(candidateAccount.candidateVotes.toNumber()).to.equal(0);

      const pollAccount = await program.account.pollAccount.fetch(
        permPollAddress,
      );
      expect(pollAccount.pollOptionIndex.toNumber()).to.equal(1);
    });
  });
});
