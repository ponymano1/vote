import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import { Vote } from "../target/types/vote";

const PROGRAM_ID = new PublicKey(
  "71DneA16fd9TThE6k1ziJbhYBjyYTppBk2HTDLMJffxC",
);

describe("vote", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.vote as Program<Vote>;

  const POLL_ID = new BN(1);

  const [pollAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from("poll"), POLL_ID.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID,
  );

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

    const pollAccount = await program.account.pollAccount.fetch(pollAddress);
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

    const pollAccount = await program.account.pollAccount.fetch(pollAddress);
    console.log("Poll Account:", pollAccount);

    expect(pollAccount.pollOptionIndex.toNumber()).to.equal(2);
  });

  it("votes for a candidate", async () => {
    const [aliceAddress] = PublicKey.findProgramAddressSync(
      [POLL_ID.toArrayLike(Buffer, "le", 8), Buffer.from("Alice")],
      PROGRAM_ID,
    );

    await program.methods.vote(POLL_ID, "Alice").rpc();

    const candidateAccount = await program.account.candidateAccount.fetch(
      aliceAddress,
    );
    console.log("Candidate Account:", candidateAccount);

    expect(candidateAccount.candidateVotes.toNumber()).to.equal(1);
  });
});
