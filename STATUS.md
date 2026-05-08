# x402 Status

## Version 0.4.1
- Released: 2026-04-17
- Payment Protocol: Multi-chain (EVM Base, Solana, Cardano)
- MCP Support: 1.27.1 compatible

## Supported Chains
- **Base (EVM)**: USDC via EIP-3009 (gasless)
- **Solana**: USDC via PST (facilitator-based)
- **Cardano**: ADA, iUSD, USDM, DJED, USDCx

## Security Layers
1. Encrypted Vault (AES-256-GCM)
2. Process Isolation (signer in isolated process)
3. Policy Engine (resource limits)
4. KMS Integration (AWS KMS for production)

## Integration Status
- OpenMM-MCP: ✓ Active integration
- StratForge: ✓ Available for payments
- Error handling: ✓ Production-ready (serialization fix in 0.4.1)

## Last Check
2026-05-08 — All tests passing (16 test suites, 220 tests, 18 skipped). Payment verification awaiting mocks. Multi-chain support stable.
Thu May 08 19:15:00 EEST 2026: status check
