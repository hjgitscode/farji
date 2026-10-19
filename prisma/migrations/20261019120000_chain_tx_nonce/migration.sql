-- Phase 9: additive. The sender's account nonce of a reported transaction.
--
-- Needed to detect a REPLACED or DROPPED transaction safely once the transaction itself has
-- vanished from the node: a PENDING row whose hash is unknown and whose (fromAddress, txNonce)
-- has been consumed by a finalised transaction was replaced (DROPPED); it is never "assumed" dropped.
-- Set once at insert from the transaction the server itself fetched; it never changes.

ALTER TABLE "BlockchainTransaction" ADD COLUMN "txNonce" BIGINT;

ALTER TABLE "BlockchainTransaction"
  ADD CONSTRAINT "BlockchainTransaction_txNonce_check" CHECK ("txNonce" IS NULL OR "txNonce" >= 0);

-- txNonce follows the transaction identity: immutable once the row exists.
DROP TRIGGER "immutable" ON "BlockchainTransaction";
CREATE TRIGGER immutable BEFORE UPDATE ON "BlockchainTransaction" FOR EACH ROW EXECUTE FUNCTION farji_immutable_columns(
  'chainId', 'txHash', 'purpose', 'targetType', 'targetId', 'targetSequence', 'fromAddress', 'initiatedByUserId', 'organisationId', 'submittedAt', 'txNonce');
