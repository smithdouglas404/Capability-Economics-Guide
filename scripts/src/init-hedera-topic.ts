/**
 * One-time setup script — create the Hedera Consensus Service topic that
 * the audit chain anchors into.
 *
 * Run after setting HEDERA_OPERATOR_ID + HEDERA_OPERATOR_KEY in your env.
 * Prints the new topic id; save as HEDERA_AUDIT_TOPIC_ID on Railway.
 *
 *   pnpm --filter @workspace/scripts run init:hedera-topic
 *
 * Cost: ~$0.01 USD-equivalent in HBAR (testnet is free). Idempotent in the
 * sense that you can run it multiple times — each run creates a new topic;
 * the operator only saves the one they want to use.
 */
async function main(): Promise<void> {
  const operatorId = process.env.HEDERA_OPERATOR_ID;
  const operatorKey = process.env.HEDERA_OPERATOR_KEY;
  if (!operatorId || !operatorKey) {
    console.error("HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY must be set.");
    console.error("Get them from https://portal.hedera.com/register (free testnet account).");
    process.exit(1);
  }
  const network = (process.env.HEDERA_NETWORK ?? "testnet").toLowerCase();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdk = await import("@hashgraph/sdk") as any;
  const { Client, AccountId, PrivateKey, TopicCreateTransaction } = sdk;
  const client = (network === "mainnet") ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(AccountId.fromString(operatorId), PrivateKey.fromString(operatorKey));

  const tx = await new TopicCreateTransaction()
    .setTopicMemo("Capability Economics — audit chain (admin-key rotations, KYC, marketplace events, security incidents)")
    .execute(client);
  const receipt = await tx.getReceipt(client);
  const topicId = receipt.topicId?.toString();
  if (!topicId) {
    console.error("Topic create returned no topicId.");
    process.exit(1);
  }
  console.log(`✓ Hedera topic created on ${network}: ${topicId}`);
  console.log("");
  console.log("Next step:");
  console.log(`  Railway → capabilityeconomics → Variables`);
  console.log(`  Add HEDERA_AUDIT_TOPIC_ID=${topicId}`);
  console.log(`  Add HEDERA_NETWORK=${network} (if not already set)`);
  console.log(`  Save → service redeploys → /admin/audit-chain shows live receipts.`);
  console.log("");
  console.log(`HashScan: https://hashscan.io/${network}/topic/${topicId}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error("Failed:", err); process.exit(1); });
