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

      await program.methods
        .initializeCandidate(PERM_POLL_ID, "Charlie")
        .rpc();

      const candidateAccount =
        await program.account.candidateAccount.fetch(charlieAddress);

      expect(candidateAccount.candidateName).to.equal("Charlie");
      expect(candidateAccount.candidateVotes.toNumber()).to.equal(0);

      const pollAccount = await program.account.pollAccount.fetch(
        permPollAddress,
      );
      expect(pollAccount.pollOptionIndex.toNumber()).to.equal(1);
    });
  });
});
